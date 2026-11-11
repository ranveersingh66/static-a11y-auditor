/**
 * auditor.js — Static A11y Auditor
 *
 * Zero-dependency, browser-only accessibility linter.
 * Uses DOMParser to safely analyse HTML without executing scripts.
 *
 * WCAG rules implemented:
 *   1. Image alt text
 *   2. Form label association
 *   3. Heading hierarchy (no skipped levels)
 *   4. Interactive element labels (button / anchor)
 *   5. <html lang> attribute
 */

"use strict";

/* ================================================================
   CONSTANTS & CONFIG
   ================================================================ */

/** Severity levels (also map to CSS class suffixes) */
const SEV = Object.freeze({ ERROR: "error", WARN: "warning", PASS: "pass" });

/**
 * Alt-text values that are present but convey nothing useful.
 * Flagged as warnings rather than errors.
 */
const SUSPICIOUS_ALT_PATTERNS = [
  /^image$/i,
  /^photo$/i,
  /^picture$/i,
  /^icon$/i,
  /^logo$/i,
  /^graphic$/i,
  /^img$/i,
  /^thumbnail$/i,
  /^banner$/i,
  /^placeholder$/i,
  /^\d+$/, // purely numeric alt
];

/* ================================================================
   UTILITY HELPERS
   ================================================================ */

/**
 * Returns a short, human-readable snippet of an element's opening tag.
 * Strips event-handler attributes and limits total length.
 *
 * @param {Element} el
 * @returns {string}
 */
function snippetOf(el) {
  const clone = el.cloneNode(false); // shallow clone — no children
  // Remove event-handler attributes (on*)
  Array.from(clone.attributes)
    .filter((a) => a.name.startsWith("on"))
    .forEach((a) => clone.removeAttribute(a.name));

  // outerHTML of an empty element gives us just the opening tag + closing
  let raw = clone.outerHTML;

  // For non-void elements, trim the auto-added </tag> so we show just the opener
  const voidTags = new Set([
    "area", "base", "br", "col", "embed", "hr", "img",
    "input", "link", "meta", "param", "source", "track", "wbr",
  ]);
  if (!voidTags.has(el.tagName.toLowerCase())) {
    const closeTag = `</${el.tagName.toLowerCase()}>`;
    if (raw.endsWith(closeTag)) raw = raw.slice(0, -closeTag.length);
    // Add ellipsis if element has children
    if (el.childNodes.length) raw += "…>";
  }

  // Truncate very long snippets
  const MAX = 120;
  return raw.length > MAX ? raw.slice(0, MAX) + "…" : raw;
}

/**
 * Returns visible text content of an element (trims and collapses whitespace).
 *
 * @param {Element} el
 * @returns {string}
 */
function visibleText(el) {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

/**
 * Checks whether an element has a usable aria-label or aria-labelledby.
 *
 * @param {Element} el
 * @param {Document} doc — the parsed document (for getElementById)
 * @returns {boolean}
 */
function hasAriaLabel(el, doc) {
  const label = (el.getAttribute("aria-label") || "").trim();
  if (label) return true;

  const labelledBy = (el.getAttribute("aria-labelledby") || "").trim();
  if (!labelledBy) return false;

  // aria-labelledby may reference multiple IDs
  return labelledBy.split(/\s+/).some((id) => {
    const ref = doc.getElementById(id);
    return ref && visibleText(ref);
  });
}

/* ================================================================
   RULE DEFINITIONS
   Each rule is an object with:
     id       — short identifier (string)
     title    — human-readable rule name (string)
     run(doc) — function that returns an array of Issue objects
   ================================================================ */

/**
 * @typedef {Object} Issue
 * @property {string} severity  — SEV.ERROR | SEV.WARN | SEV.PASS
 * @property {string} rule      — Rule id
 * @property {string} title     — Rule title
 * @property {string} snippet   — HTML snippet string
 * @property {string} desc      — Explanation of the problem
 * @property {string} tip       — Actionable fix
 */

/* ----------------------------------------------------------------
   RULE 1: Image Alt Text
   WCAG 1.1.1 Non-text Content (Level A)
   ---------------------------------------------------------------- */
const ruleImageAlt = {
  id: "img-alt",
  title: "Image Alt Text",

  run(doc) {
    const issues = [];
    const images = doc.querySelectorAll("img");

    if (!images.length) {
      issues.push({
        severity: SEV.PASS,
        rule: this.id,
        title: this.title,
        snippet: "— (no <img> elements found)",
        desc: "No images are present in the provided HTML.",
        tip: "Nothing to do — no <img> tags were found.",
      });
      return issues;
    }

    images.forEach((img) => {
      const hasAttr = img.hasAttribute("alt");
      const altValue = (img.getAttribute("alt") || "").trim();

      if (!hasAttr) {
        issues.push({
          severity: SEV.ERROR,
          rule: this.id,
          title: this.title,
          snippet: snippetOf(img),
          desc: "This <img> is missing an alt attribute entirely. Screen readers will announce the file name or URL instead.",
          tip: 'Add alt="concise description" for meaningful images, or alt="" for decorative ones.',
        });
        return;
      }

      // Empty alt is valid ONLY for decorative images — no warning needed
      if (altValue === "") return;

      // Check for suspicious / placeholder alt text
      const suspicious = SUSPICIOUS_ALT_PATTERNS.some((re) => re.test(altValue));
      if (suspicious) {
        issues.push({
          severity: SEV.WARN,
          rule: this.id,
          title: this.title,
          snippet: snippetOf(img),
          desc: `alt="${altValue}" is a generic placeholder and conveys little meaning to screen reader users.`,
          tip: "Replace with a brief description of what the image shows or communicates.",
        });
        return;
      }

      // All good
      issues.push({
        severity: SEV.PASS,
        rule: this.id,
        title: this.title,
        snippet: snippetOf(img),
        desc: `alt="${altValue}" looks descriptive.`,
        tip: "No action required.",
      });
    });

    return issues;
  },
};

/* ----------------------------------------------------------------
   RULE 2: Form Label Association
   WCAG 1.3.1 Info and Relationships (Level A)
   WCAG 4.1.2 Name, Role, Value (Level A)
   ---------------------------------------------------------------- */
const ruleFormLabels = {
  id: "form-label",
  title: "Form Label Association",

  run(doc) {
    const issues = [];
    const controls = doc.querySelectorAll("input:not([type='hidden']), select, textarea");

    if (!controls.length) {
      issues.push({
        severity: SEV.PASS,
        rule: this.id,
        title: this.title,
        snippet: "— (no form controls found)",
        desc: "No labellable form controls are present.",
        tip: "Nothing to do.",
      });
      return issues;
    }

    controls.forEach((ctrl) => {
      // 1. aria-label / aria-labelledby
      if (hasAriaLabel(ctrl, doc)) {
        issues.push({
          severity: SEV.PASS,
          rule: this.id,
          title: this.title,
          snippet: snippetOf(ctrl),
          desc: "Has an ARIA label attribute.",
          tip: "No action required.",
        });
        return;
      }

      // 2. title attribute can serve as label (but it's a warning — tooltip is not ideal)
      if ((ctrl.getAttribute("title") || "").trim()) {
        issues.push({
          severity: SEV.WARN,
          rule: this.id,
          title: this.title,
          snippet: snippetOf(ctrl),
          desc: "Uses title as the only label. The title attribute is not reliably exposed to all assistive technologies.",
          tip: "Prefer a visible <label> element or aria-label instead of relying on title.",
        });
        return;
      }

      // 3. <label for="…"> pointing to this element's id
      const id = ctrl.getAttribute("id");
      if (id) {
        const label = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label && visibleText(label)) {
          issues.push({
            severity: SEV.PASS,
            rule: this.id,
            title: this.title,
            snippet: snippetOf(ctrl),
            desc: `Labelled by <label for="${id}">.`,
            tip: "No action required.",
          });
          return;
        }
      }

      // 4. Control wrapped inside a <label>
      if (ctrl.closest("label")) {
        issues.push({
          severity: SEV.PASS,
          rule: this.id,
          title: this.title,
          snippet: snippetOf(ctrl),
          desc: "Wrapped inside a <label> element (implicit labelling).",
          tip: "No action required.",
        });
        return;
      }

      // 5. No label found — error
      issues.push({
        severity: SEV.ERROR,
        rule: this.id,
        title: this.title,
        snippet: snippetOf(ctrl),
        desc: "This form control has no associated label. Screen reader users won't know what it's for.",
        tip: id
          ? `Add <label for="${id}">Your Label</label> before this element, or add aria-label="…" directly on the control.`
          : 'Give the control a unique id, then add <label for="that-id">Your Label</label>, or add aria-label="…" directly.',
      });
    });

    return issues;
  },
};

/* ----------------------------------------------------------------
   RULE 3: Heading Hierarchy
   WCAG 1.3.1 Info and Relationships (Level A)
   WCAG 2.4.6 Headings and Labels (Level AA)
   ---------------------------------------------------------------- */
const ruleHeadingHierarchy = {
  id: "heading-order",
  title: "Heading Hierarchy",

  run(doc) {
    const issues = [];
    const headings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"));

    if (!headings.length) {
      issues.push({
        severity: SEV.WARN,
        rule: this.id,
        title: this.title,
        snippet: "— (no headings found)",
        desc: "No heading elements were found. Headings help users navigate page sections.",
        tip: "Add at least one meaningful heading using <h1> through <h6>.",
      });
      return issues;
    }

    // Check there is exactly one <h1>
    const h1s = headings.filter((h) => h.tagName === "H1");
    if (h1s.length === 0) {
      issues.push({
        severity: SEV.ERROR,
        rule: this.id,
        title: this.title,
        snippet: "— (missing <h1>)",
        desc: "No <h1> found. Every page should have exactly one top-level heading.",
        tip: "Add a single <h1> that describes the main purpose of the page.",
      });
    } else if (h1s.length > 1) {
      issues.push({
        severity: SEV.WARN,
        rule: this.id,
        title: this.title,
        snippet: `${h1s.length} × <h1> found`,
        desc: "Multiple <h1> elements found. This can confuse assistive technologies about the page's primary heading.",
        tip: "Use a single <h1> for the main page title. Use <h2>–<h6> for sub-sections.",
      });
    }

    // Check for skipped levels
    let prev = 0;
    headings.forEach((heading) => {
      const level = parseInt(heading.tagName[1], 10);
      const text = visibleText(heading) || `(empty ${heading.tagName})`;

      if (prev !== 0 && level > prev + 1) {
        issues.push({
          severity: SEV.ERROR,
          rule: this.id,
          title: this.title,
          snippet: snippetOf(heading),
          desc: `Heading level skipped: <h${prev}> is immediately followed by <h${level}> ("${text}"). This breaks the logical document outline.`,
          tip: `Use <h${prev + 1}> here instead of <h${level}>, or restructure your heading order so no levels are skipped.`,
        });
      } else {
        // Only emit a PASS for each heading that is in correct order (avoid flooding passes)
        if (level <= prev + 1) {
          issues.push({
            severity: SEV.PASS,
            rule: this.id,
            title: this.title,
            snippet: snippetOf(heading),
            desc: `<h${level}> "${text}" is in correct hierarchical order.`,
            tip: "No action required.",
          });
        }
      }

      prev = level;
    });

    return issues;
  },
};

/* ----------------------------------------------------------------
   RULE 4: Interactive Element Labels (Buttons & Anchors)
   WCAG 4.1.2 Name, Role, Value (Level A)
   ---------------------------------------------------------------- */
const ruleInteractiveLabels = {
  id: "interactive-label",
  title: "Interactive Element Labels",

  run(doc) {
    const issues = [];
    const elements = doc.querySelectorAll("button, a");

    if (!elements.length) {
      issues.push({
        severity: SEV.PASS,
        rule: this.id,
        title: this.title,
        snippet: "— (no buttons or links found)",
        desc: "No interactive elements found.",
        tip: "Nothing to do.",
      });
      return issues;
    }

    elements.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const text = visibleText(el);

      // Check aria-label / aria-labelledby first
      if (hasAriaLabel(el, doc)) {
        issues.push({
          severity: SEV.PASS,
          rule: this.id,
          title: this.title,
          snippet: snippetOf(el),
          desc: `<${tag}> has an ARIA label — accessible name is provided.`,
          tip: "No action required.",
        });
        return;
      }

      // Check visible text content
      if (text) {
        issues.push({
          severity: SEV.PASS,
          rule: this.id,
          title: this.title,
          snippet: snippetOf(el),
          desc: `<${tag}> has visible text: "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}".`,
          tip: "No action required.",
        });
        return;
      }

      // Special case: <a> with no href is not really interactive
      if (tag === "a" && !el.hasAttribute("href")) {
        issues.push({
          severity: SEV.WARN,
          rule: this.id,
          title: this.title,
          snippet: snippetOf(el),
          desc: '<a> without href is not keyboard-focusable and has no accessible name.',
          tip: 'Add an href or convert to a <button>. Provide visible text or aria-label="…".',
        });
        return;
      }

      // No accessible name at all — error
      issues.push({
        severity: SEV.ERROR,
        rule: this.id,
        title: this.title,
        snippet: snippetOf(el),
        desc: `This <${tag}> has no visible text and no aria-label. Screen reader users cannot determine its purpose.`,
        tip:
          tag === "button"
            ? 'Add descriptive text inside the button, or add aria-label="Describe the action".'
            : 'Add link text inside <a>, or use aria-label="Describe the destination".',
      });
    });

    return issues;
  },
};

/* ----------------------------------------------------------------
   RULE 5: <html lang> Attribute
   WCAG 3.1.1 Language of Page (Level A)
   ---------------------------------------------------------------- */
const ruleLangAttribute = {
  id: "html-lang",
  title: "HTML Language Attribute",

  /**
   * BCP 47 primary subtag: 2-8 letter language code,
   * optionally followed by region/script subtags.
   * E.g.: "en", "en-US", "zh-Hans", "pt-BR"
   */
  LANG_RE: /^[a-z]{2,8}(-[a-zA-Z0-9]{2,8})*$/i,

  run(doc) {
    const html = doc.documentElement;

    if (!html) {
      return [{
        severity: SEV.WARN,
        rule: this.id,
        title: this.title,
        snippet: "— (no <html> element found)",
        desc: "The HTML document is missing a root <html> element.",
        tip: "Wrap your content in a proper <html> element and add a lang attribute.",
      }];
    }

    const lang = (html.getAttribute("lang") || "").trim();

    if (!lang) {
      return [{
        severity: SEV.ERROR,
        rule: this.id,
        title: this.title,
        snippet: snippetOf(html),
        desc: 'The <html> element is missing the lang attribute. Screen readers rely on this to use the correct language voice.',
        tip: 'Add lang="en" (or the appropriate BCP 47 language code) to your <html> tag.',
      }];
    }

    if (!this.LANG_RE.test(lang)) {
      return [{
        severity: SEV.WARN,
        rule: this.id,
        title: this.title,
        snippet: snippetOf(html),
        desc: `lang="${lang}" doesn't appear to be a valid BCP 47 language tag.`,
        tip: 'Use a standard code like "en", "en-US", "fr", "de", "es", "zh-Hans", etc.',
      }];
    }

    return [{
      severity: SEV.PASS,
      rule: this.id,
      title: this.title,
      snippet: snippetOf(html),
      desc: `lang="${lang}" is present and appears valid.`,
      tip: "No action required.",
    }];
  },
};

/* ================================================================
   AUDIT ENGINE
   ================================================================ */

/** All rules, in display order */
const ALL_RULES = [
  ruleLangAttribute,
  ruleHeadingHierarchy,
  ruleImageAlt,
  ruleFormLabels,
  ruleInteractiveLabels,
];

/**
 * Parses htmlString and runs all rules against the resulting DOM.
 *
 * @param {string} htmlString — raw HTML to audit
 * @returns {Issue[]}
 */
function runAudit(htmlString) {
  const parser = new DOMParser();
  // "text/html" mode: safe, scripts never execute
  const doc = parser.parseFromString(htmlString, "text/html");

  const allIssues = [];
  ALL_RULES.forEach((rule) => {
    try {
      const issues = rule.run(doc);
      allIssues.push(...issues);
    } catch (err) {
      // Surface rule errors gracefully
      allIssues.push({
        severity: SEV.WARN,
        rule: rule.id,
        title: rule.title,
        snippet: "— (rule error)",
        desc: `Rule "${rule.title}" encountered an unexpected error: ${err.message}`,
        tip: "Please file a bug report.",
      });
    }
  });

  return allIssues;
}

/* ================================================================
   UI RENDERING
   ================================================================ */

/**
 * Builds a single issue <li> card element.
 *
 * @param {Issue} issue
 * @param {number} index — 1-based position (for animation staggering)
 * @returns {HTMLLIElement}
 */
function buildIssueCard(issue, index) {
  const li = document.createElement("li");
  li.className = `issue-card sev-${issue.severity}`;
  li.style.animationDelay = `${Math.min(index * 0.03, 0.4)}s`;

  // Header row (severity pill + rule name)
  const header = document.createElement("div");
  header.className = "issue-header";

  const pill = document.createElement("span");
  pill.className = "severity-pill";
  pill.textContent = issue.severity.toUpperCase();

  const rule = document.createElement("span");
  rule.className = "issue-rule";
  rule.textContent = issue.title;

  header.appendChild(pill);
  header.appendChild(rule);

  // Body (snippet + desc + tip)
  const body = document.createElement("div");
  body.className = "issue-body";

  const snippet = document.createElement("code");
  snippet.className = "issue-snippet";
  snippet.textContent = issue.snippet;

  const desc = document.createElement("p");
  desc.className = "issue-desc";
  desc.textContent = issue.desc;

  const tip = document.createElement("p");
  tip.className = "issue-tip";
  tip.innerHTML = `<span class="tip-label">Fix:</span> ${escapeHtml(issue.tip)}`;

  body.appendChild(snippet);
  body.appendChild(desc);
  if (issue.severity !== SEV.PASS) body.appendChild(tip);

  li.appendChild(header);
  li.appendChild(body);
  return li;
}

/**
 * Minimal HTML escaper for text inserted via innerHTML.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Renders all issues to the results panel and updates summary badges.
 *
 * @param {Issue[]} issues
 */
function renderResults(issues) {
  const listEl    = document.getElementById("results-list");
  const idleEl    = document.getElementById("results-idle");
  const passEl    = document.getElementById("results-pass");
  const badgesEl  = document.getElementById("summary-badges");
  const badgeErr  = document.getElementById("badge-error");
  const badgeWarn = document.getElementById("badge-warning");
  const badgePass = document.getElementById("badge-pass");

  // Clear previous results
  listEl.innerHTML = "";

  // Count severities
  const counts = { [SEV.ERROR]: 0, [SEV.WARN]: 0, [SEV.PASS]: 0 };
  issues.forEach((i) => counts[i.severity]++);

  // Show badges
  badgesEl.hidden = false;
  badgeErr.textContent  = `${counts[SEV.ERROR]} ${counts[SEV.ERROR] === 1 ? "Error" : "Errors"}`;
  badgeWarn.textContent = `${counts[SEV.WARN]} ${counts[SEV.WARN] === 1 ? "Warning" : "Warnings"}`;
  badgePass.textContent = `${counts[SEV.PASS]} ${counts[SEV.PASS] === 1 ? "Pass" : "Passes"}`;

  idleEl.hidden = true;

  const hasProblems = counts[SEV.ERROR] > 0 || counts[SEV.WARN] > 0;

  if (!hasProblems && counts[SEV.PASS] > 0) {
    // All-pass state
    passEl.hidden = false;
    listEl.hidden = true;
    return;
  }

  passEl.hidden = true;
  listEl.hidden = false;

  // Sort: errors first, then warnings, then passes
  const ORDER = { [SEV.ERROR]: 0, [SEV.WARN]: 1, [SEV.PASS]: 2 };
  const sorted = [...issues].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  sorted.forEach((issue, idx) => {
    listEl.appendChild(buildIssueCard(issue, idx + 1));
  });

  // Scroll results panel into view on mobile
  listEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ================================================================
   THEME TOGGLE
   ================================================================ */
function initTheme() {
  const toggle = document.getElementById("theme-toggle");
  const icon   = toggle.querySelector(".theme-icon");

  // Respect system preference as default
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  let isDark = prefersDark;

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    icon.textContent = isDark ? "☀️" : "🌙";
    toggle.setAttribute(
      "aria-label",
      isDark ? "Switch to light theme" : "Switch to dark theme"
    );
  }

  applyTheme();

  toggle.addEventListener("click", () => {
    isDark = !isDark;
    applyTheme();
  });
}

/* ================================================================
   FILE UPLOAD
   ================================================================ */
function initFileUpload() {
  const fileInput = document.getElementById("file-upload");
  const textarea  = document.getElementById("html-input");

  fileInput.addEventListener("change", (evt) => {
    const file = evt.target.files[0];
    if (!file) return;

    if (!file.name.match(/\.html?$/i)) {
      alert("Please select an .html or .htm file.");
      fileInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      textarea.value = e.target.result;
      textarea.focus();
    };
    reader.onerror = () => alert("Could not read the file. Please try again.");
    reader.readAsText(file);

    // Reset so the same file can be re-loaded if needed
    fileInput.value = "";
  });
}

/* ================================================================
   MAIN CONTROLLER — wires everything together
   ================================================================ */
function init() {
  initTheme();
  initFileUpload();

  const auditBtn  = document.getElementById("audit-btn");
  const clearBtn  = document.getElementById("clear-btn");
  const textarea  = document.getElementById("html-input");
  const listEl    = document.getElementById("results-list");
  const idleEl    = document.getElementById("results-idle");
  const passEl    = document.getElementById("results-pass");
  const badgesEl  = document.getElementById("summary-badges");

  /* --- Run Audit ------------------------------------------------ */
  auditBtn.addEventListener("click", () => {
    const html = textarea.value.trim();

    if (!html) {
      textarea.focus();
      textarea.style.outline = "3px solid var(--clr-error)";
      setTimeout(() => (textarea.style.outline = ""), 1500);
      return;
    }

    const issues = runAudit(html);
    renderResults(issues);
  });

  /* --- Keyboard shortcut: Ctrl/Cmd + Enter runs audit ----------- */
  textarea.addEventListener("keydown", (evt) => {
    if ((evt.ctrlKey || evt.metaKey) && evt.key === "Enter") {
      evt.preventDefault();
      auditBtn.click();
    }
  });

  /* --- Clear ---------------------------------------------------- */
  clearBtn.addEventListener("click", () => {
    textarea.value = "";
    listEl.innerHTML = "";
    listEl.hidden   = true;
    passEl.hidden   = true;
    badgesEl.hidden = true;
    idleEl.hidden   = false;
    textarea.focus();
  });
}

// Boot once the DOM is ready
document.addEventListener("DOMContentLoaded", init);

