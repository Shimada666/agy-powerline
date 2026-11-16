#!/usr/bin/env node
const __files = {};
const __cache = {};
function __require(from, id) {
  if (!id.startsWith(".")) {
    return require(id);
  }
  let key = require("path").posix.join(require("path").posix.dirname(from), id);
  if (!key.endsWith(".js")) {
    key += ".js";
  }
  if (!__files[key]) {
    const err = new Error(`Cannot find module '${id}' from '${from}'`);
    err.code = "MODULE_NOT_FOUND";
    throw err;
  }
  if (!__cache[key]) {
    const module = { exports: {} };
    __cache[key] = module;
    __files[key](module, module.exports, (next) => __require(key, next));
  }
  return __cache[key].exports;
}

__files["shared.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const {
  RESET,
  BLINK,
  BLINK_OFF,
  setActiveDepth,
  getActiveDepth,
  resolveColorDepth,
  resolveAscii,
  rgbToAnsi256,
  parseColor,
} = require("./colors");

const {
  THEMES,
  THEME_ORDER,
  THEME_KINDS,
  THEME_ALIASES,
  canonicalThemeId,
  buildCustomTheme,
  resolveTheme,
  themeColors,
} = require("./themes");

const {
  setConfigDir,
  getConfigDir,
  getConfigPath,
  LAYOUTS,
  LAYOUT_ORDER,
  DEFAULT_THRESHOLDS,
  resolveLayoutId,
  defaultConfig,
  mergeConfig,
  readConfigFile,
  loadConfig,
  InvalidConfigError,
  saveConfig,
  PRESETS,
  PRESET_ORDER,
  applyPreset,
  applyRenderOverrides,
} = require("./config");

const {
  quotaColor,
  contextColor,
  resolveQuotaThresholds,
  resolveContextThresholds,
  shouldBlink,
  basenameOf,
  homePath,
  sanitizeDeep,
} = require("./formatters");

const { extractSession } = require("./session");
const { execPayloadJson } = require("./exec");
const { fitWidgets, truncateLines, widestLine } = require("./fit");

const {
  deriveLinesPalette,
  colorForRemainingPct,
  renderDotMeter,
  buildLinesSegment,
  buildLinesRows,
  renderLinesLayout,
} = require("./layouts/lines");

const { buildRows, renderPillRows } = require("./layouts/pills");
const { applyStyle, detectStyle } = require("./powerline");

// Silently rendering defaults would leave a broken config unnoticed, so the
// bar gets a warning line on top. The reason goes to stderr, not the bar.
function configWarning(overrides) {
  const env = overrides.env || process.env;
  const plain = "[agy-powerline: invalid statusline.config.json, showing defaults]";
  const depth = resolveColorDepth({ cliColor: overrides.color, env });
  return depth === "none" ? plain : `\x1b[33m${plain}${RESET}`;
}

function renderStatusline(data, config, overrides = {}) {
  const out = renderBar(data, config, overrides);
  return overrides.configError ? `${configWarning(overrides)}\n${out}` : out;
}

function renderBar(data, config, overrides) {
  const resolved = mergeConfig(config);
  const env = overrides.env || process.env;
  const ascii = resolveAscii(resolved, overrides, env);
  const emojis = resolved.emojis && !ascii;
  const colors = themeColors(resolved.theme, resolved.customTheme);
  // Payload fields and branch names are untrusted: strip terminal control
  // sequences from every string before any layout prints it.
  // Valid JSON can still be null, a number or an array; read those as empty.
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const session = sanitizeDeep(
    extractSession(payload, resolved, { readUsage: overrides.usage === "read" })
  );
  // Exec widgets only run when the caller opts in ("run"); CLI previews keep
  // the default placeholder so rendering a config never executes it.
  session.execMode =
    overrides.exec === "run" || overrides.exec === "blocked" ? overrides.exec : "preview";
  session.execMemo = new Map();
  // Web previews only: mark the gaps between widget groups (see joinFlex).
  session.flexGaps = overrides.flexGaps === true;
  // Built only when a command will run and asked for it.
  if (
    session.execMode === "run" &&
    resolved.widgets.some((widget) => widget.id === "exec" && widget.payload === true)
  ) {
    session.execPayload = execPayloadJson(payload);
  }

  const prevDepth = getActiveDepth();

  setActiveDepth(
    resolveColorDepth({
      configColor: resolved.color,
      cliColor: overrides.color,
      env,
    })
  );

  try {
    const draw = (widgets) =>
      renderLayout(session, { ...resolved, widgets }, emojis, ascii, colors);
    const width = session.terminalWidth;
    let out = draw(resolved.widgets);

    // A bar wider than the terminal wraps into a mess, so overflowing rows
    // lose labels, then their least useful widgets, and are cut as a last resort.
    if (width > 0 && widestLine(out) > width) {
      out = draw(fitWidgets(resolved.widgets, width, (row) => widestLine(draw(row))));
      out = truncateLines(out, width, ascii);
    }

    return out;
  } finally {
    setActiveDepth(prevDepth);
  }
}

function renderLayout(session, config, emojis, ascii, colors) {
  // Classic is Lines with block meters and | dividers.
  if (config.layout === "lines" || config.layout === "classic") {
    return renderLinesLayout(session, emojis, ascii, colors, config);
  }

  // Pills read ascii from the config, so CLI and env overrides must land there.
  const pillConfig = { ...config, emojis, ascii };
  const rows = buildRows(session, pillConfig, colors);

  if (!rows.length) {
    return RESET;
  }

  return renderPillRows(rows, session, colors, pillConfig) + RESET;
}

module.exports = {
  // Config
  setConfigDir,
  getConfigDir,
  getConfigPath,
  LAYOUTS,
  LAYOUT_ORDER,
  resolveLayoutId,
  defaultConfig,
  readConfigFile,
  loadConfig,
  InvalidConfigError,
  saveConfig,
  mergeConfig,
  PRESETS,
  PRESET_ORDER,
  applyPreset,
  applyRenderOverrides,
  applyStyle,
  detectStyle,

  // Widget Catalog (lazy loaded)
  get WIDGET_CATALOG() {
    return require("./catalog").WIDGET_CATALOG;
  },
  get WIDGET_BY_ID() {
    return require("./catalog").WIDGET_BY_ID;
  },
  widgetLabel: (id) => require("./catalog").widgetLabel(id),

  // Themes
  THEMES,
  THEME_ORDER,
  THEME_KINDS,
  THEME_ALIASES,
  canonicalThemeId,
  themeColors,
  resolveTheme,
  buildCustomTheme,

  // Rendering
  renderStatusline,
  deriveLinesPalette,
  colorForRemainingPct,
  renderDotMeter,
  buildLinesSegment,
  buildLinesRows,

  // Mock Data (lazy loaded)
  sampleData: () => require("./mock-data").sampleData(),

  // Colors & String Helpers
  parseColor,
  homePath,
  basenameOf,
  resolveColorDepth,
  resolveAscii,
  rgbToAnsi256,
  BLINK,
  BLINK_OFF,

  // Thresholds & Alerts
  DEFAULT_THRESHOLDS,
  resolveQuotaThresholds,
  resolveContextThresholds,
  shouldBlink,
  quotaColor,
  contextColor,

  // Exec Widget
  runExecWidget: (widget, session) => require("./exec").runExecWidget(widget, session),
  sanitizeExecOutput: (text) => require("./exec").sanitizeExecOutput(text),
  clearExecCache: () => require("./exec").clearExecCache(),
  cacheKey: (cmd, cwd) => require("./exec").cacheKey(cmd, cwd),
};
};
__files["colors.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const CSI = "\x1b[";
const RESET = `${CSI}0m`;
const BOLD = `${CSI}1m`;
const DIM = `${CSI}2m`;
// Normal intensity: ends bold (and dim) without resetting colors.
const NORMAL = `${CSI}22m`;
const BLINK = `${CSI}5m`;
const BLINK_OFF = `${CSI}25m`;

let activeDepth = "truecolor";

function setActiveDepth(depth) {
  activeDepth = depth;
}

function getActiveDepth() {
  return activeDepth;
}

const COLOR_MODES = ["auto", "truecolor", "256", "none"];

function resolveColorModeId(mode) {
  return COLOR_MODES.includes(mode) ? mode : "auto";
}

function isTruthyFlag(value) {
  return /^(1|true|yes)$/i.test(String(value ?? "").trim());
}

function detectColorDepth(env = {}) {
  if (env?.NO_COLOR !== undefined && String(env.NO_COLOR) !== "") {
    return "none";
  }

  const colorterm = String(env?.COLORTERM ?? "").trim();

  if (/^(truecolor|24bit)$/i.test(colorterm)) {
    return "truecolor";
  }

  if (/256colou?r/i.test(`${env?.TERM ?? ""} ${colorterm}`)) {
    return "256";
  }

  if (String(env?.TERM ?? "").trim() === "dumb") {
    return "none";
  }

  return "truecolor";
}

function resolveColorDepth({ configColor = "auto", cliColor = "", env = {} } = {}) {
  const cli = String(cliColor || "").toLowerCase();

  if (cli === "truecolor" || cli === "256" || cli === "none") {
    return cli;
  }

  if (env?.NO_COLOR !== undefined && String(env.NO_COLOR) !== "") {
    return "none";
  }

  const fromEnv = String(env?.AGY_POWERLINE_COLOR || "").toLowerCase();

  if (fromEnv === "truecolor" || fromEnv === "256" || fromEnv === "none") {
    return fromEnv;
  }

  if (configColor === "truecolor" || configColor === "256" || configColor === "none") {
    return configColor;
  }

  return detectColorDepth(env);
}

function resolveAscii(config, overrides = {}, env = {}) {
  if (overrides.ascii === true) {
    return true;
  }

  if (overrides.ascii === false) {
    return false;
  }

  return Boolean(config?.ascii) || isTruthyFlag(env?.AGY_POWERLINE_ASCII);
}

function rgb(r, g, b) {
  return [r, g, b];
}

// The nearest xterm color: the 6x6x6 cube's levels (0, 95, 135, ... 255) are
// not evenly spaced, and a near-gray reads better from the gray ramp, so both
// candidates are measured and the closer one wins (as tmux does).
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function rgbToAnsi256([r, g, b]) {
  const toCube = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40));
  const [cr, cg, cb] = [toCube(r), toCube(g), toCube(b)];
  const cube = [CUBE_LEVELS[cr], CUBE_LEVELS[cg], CUBE_LEVELS[cb]];

  const average = (r + g + b) / 3;
  const grayIndex = average > 238 ? 23 : Math.max(0, Math.floor((average - 3) / 10));
  const level = 8 + 10 * grayIndex;
  const distance = ([x, y, z]) => (x - r) ** 2 + (y - g) ** 2 + (z - b) ** 2;

  return distance([level, level, level]) < distance(cube)
    ? 232 + grayIndex
    : 16 + 36 * cr + 6 * cg + cb;
}

function colorSeq(kind, [r, g, b]) {
  if (activeDepth === "none") {
    return "";
  }

  if (activeDepth === "256") {
    return `${CSI}${kind};5;${rgbToAnsi256([r, g, b])}m`;
  }

  return `${CSI}${kind};2;${r};${g};${b}m`;
}

function fg(rgb) {
  return colorSeq(38, rgb);
}

function bg(rgb) {
  return colorSeq(48, rgb);
}

// Back to the terminal's own background, whatever it is (dark or light).
function bgDefault() {
  return activeDepth === "none" ? "" : CSI + "49m";
}

function shade(color, amount) {
  return color.map((n) => Math.round(n * amount));
}

// t of the way from color a to color b.
function mix(a, b, t) {
  return a.map((value, i) => Math.round(value + (b[i] - value) * t));
}

function parseColor(value, fallback = [200, 200, 200]) {
  if (value == null) {
    return fallback;
  }

  if (Array.isArray(value)) {
    if (value.length >= 3) {
      const r = Math.max(0, Math.min(255, Number(value[0])));
      const g = Math.max(0, Math.min(255, Number(value[1])));
      const b = Math.max(0, Math.min(255, Number(value[2])));
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return [Math.round(r), Math.round(g), Math.round(b)];
      }
    }
    return fallback;
  }

  if (typeof value === "object") {
    if ("r" in value && "g" in value && "b" in value) {
      const r = Math.max(0, Math.min(255, Number(value.r)));
      const g = Math.max(0, Math.min(255, Number(value.g)));
      const b = Math.max(0, Math.min(255, Number(value.b)));
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        return [Math.round(r), Math.round(g), Math.round(b)];
      }
    }
    return fallback;
  }

  if (typeof value === "string") {
    const s = value.trim();

    const hexMatch = s.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      const num = parseInt(hex, 16);
      return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    }

    const rgbMatch = s.match(/^(?:rgb\s*\(\s*)?(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)?$/i);
    if (rgbMatch) {
      const r = Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10)));
      const g = Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10)));
      const b = Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10)));
      return [r, g, b];
    }
  }

  return fallback;
}

function linear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function gamma(v) {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

// WCAG relative luminance and contrast ratio.
function luminance([r, g, b]) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// OKLab (Björn Ottosson): mixing there keeps the middle of a gradient as
// bright and saturated as its ends, where sRGB mixing turns it muddy.
function toOklab([r, g, b]) {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const MAX_GRADIENT_STOPS = 6;
const HEX_STOP = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// "#ff5f6d-#ffc371" (2 to 6 hex stops, "#" optional) to RGB stops, or null.
function parseGradientStops(spec) {
  if (typeof spec !== "string") {
    return null;
  }
  const parts = spec.trim().split("-");
  if (parts.length < 2 || parts.length > MAX_GRADIENT_STOPS) {
    return null;
  }
  if (!parts.every((part) => HEX_STOP.test(part))) {
    return null;
  }
  return parts.map((part) => parseColor(part));
}

// The color t (0 to 1) of the way along the stops; the ends are exact.
function gradientAt(stops, t) {
  const clamped = Math.max(0, Math.min(1, Number(t) || 0));
  const span = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(span));
  const local = span - i;
  if (local === 0) {
    return [...stops[i]];
  }
  if (local === 1) {
    return [...stops[i + 1]];
  }
  const [a, b] = [toOklab(stops[i]), toOklab(stops[i + 1])];
  return fromOklab(a.map((value, k) => value + (b[k] - value) * local));
}

// count evenly spaced colors from the first stop to the last.
function gradientColors(stops, count) {
  if (count <= 1) {
    return count === 1 ? [[...stops[0]]] : [];
  }
  return Array.from({ length: count }, (_, i) => gradientAt(stops, i / (count - 1)));
}

const MIN_CONTRAST = 4.5;

// The preferred text color if it reads on the background, else whichever of
// the fallbacks contrasts most.
function readableText(background, preferred, fallbacks) {
  if (contrastRatio(preferred, background) >= MIN_CONTRAST) {
    return preferred;
  }
  return fallbacks.reduce((best, color) =>
    contrastRatio(color, background) > contrastRatio(best, background) ? color : best
  );
}

// The color moved toward white (on a dark background) or black (on a light
// one), or toward the given target, just far enough to reach the minimum
// contrast.
function withContrast(
  color,
  background,
  min = MIN_CONTRAST,
  target = luminance(background) < 0.5 ? [255, 255, 255] : [0, 0, 0]
) {
  if (contrastRatio(color, background) >= min) {
    return color;
  }
  for (let step = 1; step <= 20; step++) {
    const moved = mix(color, target, step / 20);
    if (contrastRatio(moved, background) >= min) {
      return moved;
    }
  }
  return target;
}

module.exports = {
  CSI,
  RESET,
  BOLD,
  DIM,
  NORMAL,
  BLINK,
  BLINK_OFF,
  setActiveDepth,
  getActiveDepth,
  COLOR_MODES,
  resolveColorModeId,
  isTruthyFlag,
  detectColorDepth,
  resolveColorDepth,
  resolveAscii,
  rgb,
  rgbToAnsi256,
  colorSeq,
  fg,
  bg,
  bgDefault,
  shade,
  mix,
  parseColor,
  luminance,
  contrastRatio,
  toOklab,
  fromOklab,
  MAX_GRADIENT_STOPS,
  parseGradientStops,
  gradientAt,
  gradientColors,
  MIN_CONTRAST,
  readableText,
  withContrast,
};
};
__files["themes.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const { parseColor, parseGradientStops, luminance } = require("./colors");

// Every theme targets one terminal background:
//   dark-*        bright colors, dark pill text, for dark terminals
//   light-*       deep colors, white pill text, for light terminals
//   colorblind-*  Okabe–Ito based; ok / caution / danger stay distinct for
//                 protanopia, deuteranopia and tritanopia
// Most dark-* and light-* colors come from VS Code's default themes (Dark+
// and Light+ syntax, git decorations, warning/error and terminal colors);
// nocturne, onyx, metro, macchiato, nord, rose-pine, cream, gruvbox and tokyo-night take their
// palettes from community themes (credited below). A few colors are adjusted where the
// checks below need it: darkened or lightened for contrast, and gitDirty
// moved toward orange so a dirty branch never looks like the caution state.
// Palettes are checked by tests/shared/themes.test.js: pill text and lines
// text reach WCAG AA (4.5:1), the ok / caution / danger states are clearly
// different from each other, and so are gitDirty and caution.
//
// Color roles:
//   text      pill text                  track     empty dots in lines meters
//   fiveHour  healthy state (ok)         caution   warning state
//   warn      danger / critical state    gitDirty  repo with uncommitted work
//   model, weekly, thirdParty, context, git, meta: widget colors

const hex = (value) => parseColor(value);

function theme(kind, name, description, colors) {
  const parsed = {};
  for (const [key, value] of Object.entries(colors)) {
    parsed[key] = hex(value);
  }
  return { kind, name, description, colors: parsed };
}

const DARK_TEXT = "#16161c";
const LIGHT_TEXT = "#ffffff";

const THEMES = {
  "dark-aurora": theme("dark", "Dark Aurora", "VS Code Dark+ colors (default)", {
    text: DARK_TEXT,
    track: "#4b4b4b",
    model: "#c586c0",
    fiveHour: "#73c991",
    weekly: "#9cdcfe",
    thirdParty: "#ce9178",
    context: "#569cd6",
    git: "#4ec9b0",
    gitDirty: "#e2c08d",
    meta: "#cccccc",
    caution: "#cca700",
    warn: "#f48771",
  }),

  "dark-ocean": theme("dark", "Dark Ocean", "Blues and teals from VS Code Dark+", {
    text: DARK_TEXT,
    track: "#4b4b4b",
    model: "#569cd6",
    fiveHour: "#4ec9b0",
    weekly: "#9cdcfe",
    thirdParty: "#4fc1ff",
    context: "#3794ff",
    git: "#29b8db",
    gitDirty: "#e2c08d",
    meta: "#9d9d9d",
    caution: "#cca700",
    warn: "#f48771",
  }),

  "dark-ember": theme("dark", "Dark Ember", "Warm oranges and golds from VS Code Dark+", {
    text: DARK_TEXT,
    track: "#4b4b4b",
    model: "#ce9178",
    fiveHour: "#b5cea8",
    weekly: "#dcdcaa",
    thirdParty: "#d7ba7d",
    context: "#9cdcfe",
    git: "#c586c0",
    gitDirty: "#e2c08d",
    meta: "#cccccc",
    caution: "#cca700",
    warn: "#f48771",
  }),

  "dark-forest": theme("dark", "Dark Forest", "Greens and sand from VS Code Dark+", {
    text: DARK_TEXT,
    track: "#4b4b4b",
    model: "#b5cea8",
    fiveHour: "#73c991",
    weekly: "#4ec9b0",
    thirdParty: "#d7ba7d",
    context: "#9cdcfe",
    git: "#81b88b",
    gitDirty: "#e2c08d",
    meta: "#cccccc",
    caution: "#cca700",
    warn: "#f48771",
  }),

  "dark-neon": theme("dark", "Dark Neon", "VS Code's bright terminal colors", {
    text: DARK_TEXT,
    track: "#4b4b4b",
    model: "#d670d6",
    fiveHour: "#23d18b",
    weekly: "#29b8db",
    thirdParty: "#ce9178",
    context: "#4b97ec",
    git: "#b180d7",
    gitDirty: "#e2c08d",
    meta: "#e5e5e5",
    caution: "#f5f543",
    warn: "#f36767",
  }),

  "dark-mono": theme("dark", "Dark Mono", "VS Code Dark Modern grays, color only for status", {
    text: DARK_TEXT,
    track: "#4b4b4b",
    model: "#d4d4d4",
    fiveHour: "#73c991",
    weekly: "#bbbbbb",
    thirdParty: "#b0b0b0",
    context: "#c8c8c8",
    git: "#cccccc",
    gitDirty: "#e2c08d",
    meta: "#9d9d9d",
    caution: "#cca700",
    warn: "#f48771",
  }),

  // Palette from Dracula (draculatheme.com, MIT).
  "dark-nocturne": theme("dark", "Dark Nocturne", "Vivid purple, pink, cyan and green", {
    text: DARK_TEXT,
    track: "#44475a",
    model: "#bd93f9",
    fiveHour: "#50fa7b",
    weekly: "#8be9fd",
    thirdParty: "#ffb86c",
    context: "#ff79c6",
    git: "#d6acff",
    gitDirty: "#ffb86c",
    meta: "#f8f8f2",
    caution: "#f1fa8c",
    warn: "#ff5555",
  }),

  // Palette from One Dark (Atom, MIT).
  "dark-onyx": theme("dark", "Dark Onyx", "Soft purple, blue and green on gray", {
    text: DARK_TEXT,
    track: "#4b5263",
    model: "#c678dd",
    fiveHour: "#98c379",
    weekly: "#56b6c2",
    thirdParty: "#d19a66",
    context: "#61afef",
    git: "#abb2bf",
    gitDirty: "#e88a50",
    meta: "#abb2bf",
    caution: "#e5c07b",
    warn: "#e1727b",
  }),

  // Palette from Tokyo Night (enkia/tokyo-night-vscode-theme, MIT).
  "dark-metro": theme("dark", "Dark Metro", "Night-city blues, violet and teal", {
    text: DARK_TEXT,
    track: "#414868",
    model: "#bb9af7",
    fiveHour: "#9ece6a",
    weekly: "#7dcfff",
    thirdParty: "#ff9e64",
    context: "#7aa2f7",
    git: "#73daca",
    gitDirty: "#ff8b52",
    meta: "#a9b1d6",
    caution: "#e0af68",
    warn: "#f7768e",
  }),

  // Palette from Catppuccin Macchiato (catppuccin.com, MIT).
  "dark-macchiato": theme("dark", "Dark Macchiato", "Pastel mauve, teal, peach and green", {
    text: DARK_TEXT,
    track: "#494d64",
    model: "#c6a0f6",
    fiveHour: "#a6da95",
    weekly: "#7dc4e4",
    thirdParty: "#f5a97f",
    context: "#8aadf4",
    git: "#8bd5ca",
    gitDirty: "#f0c6c6",
    meta: "#b8c0e0",
    caution: "#eed49f",
    warn: "#ed8796",
  }),

  // Palette from Nord (nordtheme.com, MIT).
  "dark-nord": theme("dark", "Dark Nord", "Arctic frost blues with aurora accents", {
    text: DARK_TEXT,
    track: "#4c566a",
    model: "#b48ead",
    fiveHour: "#a3be8c",
    weekly: "#88c0d0",
    thirdParty: "#d08770",
    context: "#81a1c1",
    git: "#8fbcbb",
    gitDirty: "#d08770",
    meta: "#d8dee9",
    caution: "#ebcb8b",
    warn: "#d57780",
  }),

  // Palette from Rosé Pine (rosepinetheme.com, MIT).
  "dark-rose-pine": theme("dark", "Dark Rose Pine", "Muted iris, foam, rose and gold", {
    text: DARK_TEXT,
    track: "#403d52",
    model: "#c4a7e7",
    fiveHour: "#9ccfd8",
    weekly: "#ebbcba",
    thirdParty: "#ea9a97",
    context: "#5ea6c6",
    git: "#6fb3bd",
    gitDirty: "#ea9a97",
    meta: "#e0def4",
    caution: "#f6c177",
    warn: "#eb6f92",
  }),

  "light-paper": theme("light", "Light Paper", "VS Code Light+ colors", {
    text: LIGHT_TEXT,
    track: "#c8c8c8",
    model: "#af00db",
    fiveHour: "#107c10",
    weekly: "#247790",
    thirdParty: "#795e26",
    context: "#0451a5",
    git: "#001080",
    gitDirty: "#b04a00",
    meta: "#3b3b3b",
    caution: "#8d6503",
    warn: "#cd3131",
  }),

  "light-sky": theme("light", "Light Sky", "Blues from VS Code Light+", {
    text: LIGHT_TEXT,
    track: "#c8c8c8",
    model: "#0451a5",
    fiveHour: "#097e52",
    weekly: "#247790",
    thirdParty: "#0070c1",
    context: "#005fb8",
    git: "#001080",
    gitDirty: "#b04a00",
    meta: "#3b3b3b",
    caution: "#8d6503",
    warn: "#cd3131",
  }),

  "light-sunset": theme("light", "Light Sunset", "Warm reds and browns from VS Code Light+", {
    text: LIGHT_TEXT,
    track: "#c8c8c8",
    model: "#811f3f",
    fiveHour: "#55780c",
    weekly: "#247790",
    thirdParty: "#795e26",
    context: "#0451a5",
    git: "#bc05bc",
    gitDirty: "#b04a00",
    meta: "#616161",
    caution: "#8d6503",
    warn: "#cd3131",
  }),

  // Palette from Catppuccin Latte (catppuccin.com, MIT).
  "light-cream": theme("light", "Light Cream", "Pastel mauve, teal and peach, deepened", {
    text: LIGHT_TEXT,
    track: "#bcc0cc",
    model: "#8839ef",
    fiveHour: "#317e23",
    weekly: "#117a80",
    thirdParty: "#bb4a0b",
    context: "#1d63ee",
    git: "#a3518d",
    gitDirty: "#bb4a0b",
    meta: "#4c4f69",
    caution: "#966010",
    warn: "#d20f39",
  }),

  // Palette from Gruvbox Light (github.com/morhetz/gruvbox, MIT).
  "light-gruvbox": theme("light", "Light Gruvbox", "Retro earthy purple, aqua and orange", {
    text: LIGHT_TEXT,
    track: "#bdae93",
    model: "#8f3f71",
    fiveHour: "#736e0d",
    weekly: "#076678",
    thirdParty: "#af3a03",
    context: "#427b58",
    git: "#3c3836",
    gitDirty: "#af3a03",
    meta: "#6f6560",
    caution: "#64410b",
    warn: "#9d0006",
  }),

  // Palette from Tokyo Night Light (tokyo-night/tokyo-night-vscode-theme, MIT).
  "light-tokyo-night": theme("light", "Light Tokyo Night", "Ink blue, violet and moss green", {
    text: LIGHT_TEXT,
    track: "#c8c8c8",
    model: "#5a3e8e",
    fiveHour: "#385f0d",
    weekly: "#0f4b6e",
    thirdParty: "#965027",
    context: "#2959aa",
    git: "#33635c",
    gitDirty: "#8a3c25",
    meta: "#6c6e75",
    caution: "#8f5e15",
    warn: "#7b2840",
  }),

  "colorblind-dark": theme(
    "colorblind",
    "Color-blind Dark",
    "Color-blind safe, for dark terminals",
    {
      text: DARK_TEXT,
      track: "#4a4e5e",
      model: "#cc99ff",
      fiveHour: "#56b4e9",
      weekly: "#88ccee",
      thirdParty: "#e69f00",
      context: "#7fb2ff",
      git: "#b8a6ff",
      gitDirty: "#e69f00",
      meta: "#c8c8c8",
      caution: "#f0e442",
      warn: "#ff7a3d",
    }
  ),

  "colorblind-light": theme(
    "colorblind",
    "Color-blind Light",
    "Color-blind safe, for light terminals",
    {
      text: LIGHT_TEXT,
      track: "#c8ccd4",
      model: "#5e3ea8",
      fiveHour: "#005a8c",
      weekly: "#1f6680",
      thirdParty: "#8a5200",
      context: "#2856a8",
      git: "#4e4596",
      gitDirty: "#a64800",
      meta: "#4b5466",
      caution: "#876900",
      warn: "#87002d",
    }
  ),

  custom: theme("custom", "Custom", "Your own colors from statusline.config.json", {
    text: DARK_TEXT,
    track: "#4b4b4b",
    model: "#c586c0",
    fiveHour: "#73c991",
    weekly: "#9cdcfe",
    thirdParty: "#ce9178",
    context: "#569cd6",
    git: "#4ec9b0",
    gitDirty: "#e2c08d",
    meta: "#cccccc",
    caution: "#cca700",
    warn: "#f48771",
  }),
};

const DEFAULT_THEME = "dark-aurora";

const THEME_KINDS = [
  { id: "dark", label: "Dark terminals" },
  { id: "light", label: "Light terminals" },
  { id: "colorblind", label: "Color-blind safe" },
  { id: "custom", label: "Custom" },
];

const THEME_ORDER = [
  "dark-aurora",
  "dark-ocean",
  "dark-ember",
  "dark-forest",
  "dark-neon",
  "dark-mono",
  "dark-nocturne",
  "dark-onyx",
  "dark-metro",
  "dark-macchiato",
  "dark-nord",
  "dark-rose-pine",
  "light-paper",
  "light-sky",
  "light-sunset",
  "light-cream",
  "light-gruvbox",
  "light-tokyo-night",
  "colorblind-dark",
  "colorblind-light",
  "custom",
];

// Short names shown in `theme --list`.
const THEME_ALIASES = {
  dark: "dark-aurora",
  light: "light-paper",
  colorblind: "colorblind-dark",
};

const COLOR_KEYS = [
  "text",
  "track",
  "model",
  "fiveHour",
  "weekly",
  "thirdParty",
  "context",
  "git",
  "gitDirty",
  "meta",
  "caution",
  "warn",
  // Optional: pins the background behind pill caps instead of using the
  // terminal's own background.
  "terminal",
];

function canonicalThemeId(themeId) {
  const key = String(themeId ?? "")
    .trim()
    .toLowerCase();
  return THEME_ALIASES[key] ?? key;
}

function buildCustomTheme(customThemeConfig = {}) {
  const requestedBase = canonicalThemeId(customThemeConfig.base);
  const baseId =
    THEMES[requestedBase] && requestedBase !== "custom" ? requestedBase : DEFAULT_THEME;
  const baseColors = THEMES[baseId].colors;

  const rawColors =
    customThemeConfig.colors && typeof customThemeConfig.colors === "object"
      ? customThemeConfig.colors
      : {};

  const parsedColors = { ...baseColors };

  if (rawColors && typeof rawColors === "object") {
    for (const key of COLOR_KEYS) {
      if (rawColors[key] !== undefined) {
        parsedColors[key] = parseColor(rawColors[key], baseColors[key]);
      }
    }
  }

  return {
    kind: "custom",
    name: customThemeConfig.name || "Custom",
    description: customThemeConfig.description || "User-defined color palette",
    colors: parsedColors,
  };
}

function resolveThemeId(themeId) {
  const id = canonicalThemeId(themeId);
  return THEMES[id] ? id : DEFAULT_THEME;
}

function resolveTheme(themeId, customThemeConfig) {
  const id = resolveThemeId(themeId);
  if (id === "custom") {
    return buildCustomTheme(customThemeConfig);
  }
  return THEMES[id];
}

function themeColors(themeId, customThemeConfig) {
  return resolveTheme(themeId, customThemeConfig).colors;
}

// Row gradients. Pill text and Lines text are adjusted per color to stay
// readable, so a preset works on dark and light terminals alike.
const GRADIENTS = {
  aurora: { name: "Aurora", stops: ["#00c9a7", "#4facfe", "#a18cd1"] },
  sunset: { name: "Sunset", stops: ["#ffd166", "#ff8c61", "#e8457c"] },
  ocean: { name: "Ocean", stops: ["#2af598", "#009efd"] },
  forest: { name: "Forest", stops: ["#d4fc79", "#3fb68b", "#1d7a5f"] },
  neon: { name: "Neon", stops: ["#f72585", "#7209b7", "#4cc9f0"] },
  candy: { name: "Candy", stops: ["#ff9a9e", "#fbc2eb", "#a1c4fd"] },
  rainbow: { name: "Rainbow", stops: ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93"] },
  mono: { name: "Mono", stops: ["#e0e0e0", "#6e6e6e"] },
};

const GRADIENT_ORDER = Object.keys(GRADIENTS);

const toHex = (rgb) => `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;

// A preset name, or hex stops written as "#rrggbb-#rrggbb"; null when the
// value is anything else (or "off").
function normalizeGradient(value) {
  if (typeof value !== "string") {
    return null;
  }
  const key = value.trim().toLowerCase();
  if (GRADIENTS[key]) {
    return key;
  }
  const stops = parseGradientStops(key);
  return stops ? stops.map(toHex).join("-") : null;
}

function gradientStops(value) {
  const key = normalizeGradient(value);
  if (!key) {
    return null;
  }
  return GRADIENTS[key]
    ? GRADIENTS[key].stops.map((stop) => parseColor(stop))
    : parseGradientStops(key);
}

// Typical terminal backgrounds, a little toward the hard side. Themes for
// light terminals have light pill text on deep colors; dark themes the reverse.
const TERMINAL_BACKGROUNDS = { dark: [40, 42, 54], light: [245, 245, 240] };

function terminalBackground(colors) {
  return luminance(colors?.text ?? [0, 0, 0]) > 0.5
    ? TERMINAL_BACKGROUNDS.light
    : TERMINAL_BACKGROUNDS.dark;
}

module.exports = {
  THEMES,
  THEME_ORDER,
  THEME_KINDS,
  THEME_ALIASES,
  DEFAULT_THEME,
  COLOR_KEYS,
  theme,
  canonicalThemeId,
  buildCustomTheme,
  resolveThemeId,
  resolveTheme,
  themeColors,
  GRADIENTS,
  GRADIENT_ORDER,
  normalizeGradient,
  gradientStops,
  TERMINAL_BACKGROUNDS,
  terminalBackground,
};
};
__files["config.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const fs = require("fs");
const path = require("path");
const { resolveColorModeId } = require("./colors");
const { resolveThemeId, canonicalThemeId, normalizeGradient } = require("./themes");
const { stripControl, normalizeClock } = require("./formatters");
const { normalizePowerline, applyStyle, STYLES } = require("./powerline");
const { writeFileAtomic, PRIVATE_FILE_MODE } = require("./paths");
const { isMeterStyle } = require("./widget-style");
const { resolveLanguage, matchLanguage } = require("./i18n");

// Display text in widget configs is printed as-is, so strip terminal control
// from it. cmd/command are left alone: they are executed, not printed.
function cleanWidget(widget) {
  const out = { ...widget };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string" && key !== "cmd" && key !== "command") {
      out[key] = stripControl(value);
    }
  }
  return out;
}

const VALID_WIDGET_IDS = new Set([
  "model",
  "quota",
  "fiveHourPct",
  "fiveHourReset",
  "fiveHourBar",
  "weeklyPct",
  "weeklyReset",
  "weeklyBar",
  "thirdPartyFiveHour",
  "thirdPartyWeekly",
  "argonWeekly",
  "argonReset",
  "context",
  "contextPct",
  "contextTokens",
  "cwd",
  "project",
  "os",
  "host",
  "git",
  "gitChanges",
  "gitFiles",
  "gitSha",
  "gitStash",
  "gitWorktree",
  "plan",
  "agentState",
  "artifacts",
  "tasks",
  "mode",
  "title",
  "sessionTime",
  "ram",
  "version",
  "sandbox",
  "cacheRead",
  "cacheCreate",
  "cacheHit",
  "totalTokens",
  "clock",
  "tokensToday",
  "tokensWeek",
  "exec",
  "customText",
  "separator",
  "lineBreak",
]);

// Editors that read "$schema" complete and check the config file with it.
const CONFIG_SCHEMA_URL = "https://agy-powerline.com/schema/v1.json";

let configDir = __dirname;

function setConfigDir(dir) {
  configDir = dir;
}

function getConfigDir() {
  return configDir;
}

function getConfigPath() {
  return path.join(configDir, "statusline.config.json");
}

const LAYOUTS = {
  pills: {
    id: "pills",
    name: "Pills",
    description: "Powerline clusters with caps, joins and meters",
  },
  lines: {
    id: "lines",
    name: "Lines",
    description: "Plain colored text with dividers and dot meters",
  },
  classic: {
    id: "classic",
    name: "Classic",
    description: "Plain colored text with | dividers and █░│ block meters",
  },
};

const LAYOUT_ORDER = ["pills", "lines", "classic"];

function resolveLayoutId(layoutId) {
  return LAYOUTS[layoutId] ? layoutId : "pills";
}

const DEFAULT_THRESHOLDS = {
  quotaWarn: 30,
  quotaCrit: 10,
  contextWarn: 70,
  contextCrit: 90,
  blink: false,
};

function defaultConfig() {
  return {
    theme: "dark-aurora",
    emojis: true,
    ascii: false,
    color: "auto",
    layout: "pills",
    language: "en",
    pacing: true,
    minimalist: false,
    rowGap: false,
    log: true,
    clock: normalizeClock(),
    thresholds: { ...DEFAULT_THRESHOLDS },
    powerline: normalizePowerline(),
    widgets: [
      { id: "model" },
      { id: "separator" },
      { id: "context" },
      { id: "separator" },
      { id: "git" },
      { id: "lineBreak" },
      { id: "fiveHourBar" },
      { id: "fiveHourReset" },
      { id: "separator" },
      { id: "weeklyBar" },
      { id: "weeklyReset" },
    ],
  };
}

function mergeConfig(raw) {
  const fallback = defaultConfig();
  const powerline = normalizePowerline(raw?.powerline);

  let widgetsList = fallback.widgets;
  if (Array.isArray(raw?.widgets)) {
    const normalized = raw.widgets
      .filter((widget) => widget && VALID_WIDGET_IDS.has(widget.id))
      .map(cleanWidget);
    widgetsList = normalized.length ? normalized : fallback.widgets;
  }

  const rawThresholds =
    raw && typeof raw.thresholds === "object" && raw.thresholds !== null ? raw.thresholds : {};
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...rawThresholds,
  };
  if (typeof rawThresholds.quotaWarn === "number") thresholds.quotaWarn = rawThresholds.quotaWarn;
  if (typeof rawThresholds.quotaCrit === "number") thresholds.quotaCrit = rawThresholds.quotaCrit;
  if (typeof rawThresholds.contextWarn === "number")
    thresholds.contextWarn = rawThresholds.contextWarn;
  if (typeof rawThresholds.contextCrit === "number")
    thresholds.contextCrit = rawThresholds.contextCrit;
  if (rawThresholds.blink !== undefined) thresholds.blink = rawThresholds.blink;

  const result = {
    // Kept so an editor keeps checking the file after the CLI saves it.
    ...(typeof raw?.$schema === "string" && raw.$schema.length <= 2048
      ? { $schema: stripControl(raw.$schema) }
      : {}),
    theme: resolveThemeId(raw?.theme ?? fallback.theme),
    emojis: raw?.emojis !== false,
    ascii: raw?.ascii === true,
    color: resolveColorModeId(raw?.color ?? fallback.color),
    layout: resolveLayoutId(raw?.layout ?? fallback.layout),
    // A language without messages shows English (fr-FR uses fr when there is one).
    language: resolveLanguage(raw?.language),
    pacing: raw?.pacing !== false,
    minimalist: raw?.minimalist === true,
    rowGap: raw?.rowGap === true,
    log: raw?.log !== false,
    clock: normalizeClock(raw?.clock),
    thresholds,
    powerline,
    widgets: widgetsList,
  };

  if (raw && typeof raw.customTheme === "object" && raw.customTheme !== null) {
    result.customTheme = raw.customTheme;
  }

  // An unknown meter style is left out: each layout then draws its own.
  if (isMeterStyle(raw?.meterStyle)) {
    result.meterStyle = raw.meterStyle;
  }

  // Only a valid gradient is kept; anything else renders the plain theme.
  const gradient = normalizeGradient(raw?.gradient);
  if (gradient) {
    result.gradient = gradient;
  }

  return result;
}

// A missing or empty file just means defaults. A file that can't be read or
// parsed is reported in `error` so nobody saves defaults over a config the
// user can still fix; `config` then holds the defaults to render with.
function readConfigFile() {
  let text;

  try {
    text = fs.readFileSync(getConfigPath(), "utf8").replace(/^\uFEFF/, "");
  } catch (err) {
    if (err.code === "ENOENT") {
      return { exists: false, config: defaultConfig() };
    }
    return { exists: true, config: defaultConfig(), error: stripControl(err.message) };
  }

  if (!text.trim()) {
    return { exists: true, config: defaultConfig() };
  }

  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { exists: true, config: defaultConfig(), error: "top-level value is not an object" };
    }
    return { exists: true, config: mergeConfig(raw), raw };
  } catch (err) {
    // Newer Node quotes part of the file in the message; it may hold anything.
    return { exists: true, config: defaultConfig(), error: stripControl(err.message) };
  }
}

function loadConfig() {
  return readConfigFile().config;
}

class InvalidConfigError extends Error {
  constructor(file, reason) {
    super(`${file} is not valid JSON (${reason})`);
    this.name = "InvalidConfigError";
    this.file = file;
    this.reason = reason;
  }
}

// Refuses to replace a config that exists but can't be parsed: the caller
// only ever saw defaults, and writing them would erase the user's widgets.
function saveConfig(config) {
  const current = readConfigFile();
  if (current.error) {
    throw new InvalidConfigError(getConfigPath(), current.error);
  }

  writeFileAtomic(getConfigPath(), JSON.stringify(mergeConfig(config), null, 2) + "\n", {
    mode: PRIVATE_FILE_MODE,
  });
}

// Presets set the widget list only; the layout (Pills or Lines) stays the one
// the user picked. Each answers one question and keeps all its widgets at 80
// columns (full at 100); widgets with nothing to show hide on their own.
const PRESETS = {
  default: {
    id: "default",
    name: "Default",
    description: "Model, context and git; 5h and 7d quotas with resets on a second row",
    widgets: [
      { id: "model" },
      { id: "separator" },
      { id: "context" },
      { id: "separator" },
      { id: "git" },
      { id: "lineBreak" },
      { id: "fiveHourBar" },
      { id: "fiveHourReset" },
      { id: "separator" },
      { id: "weeklyBar" },
      { id: "weeklyReset" },
    ],
  },
  compact: {
    id: "compact",
    name: "Compact",
    description: "One row: short model, tightest quota, context % and git",
    widgets: [{ id: "model", short: true }, { id: "quota" }, { id: "contextPct" }, { id: "git" }],
  },
  agent: {
    id: "agent",
    name: "Agent activity",
    description: "Agent state, subagents, title and mode; context, artifacts, quota",
    widgets: [
      { id: "agentState" },
      { id: "tasks" },
      { id: "title" },
      { id: "separator" },
      { id: "mode" },
      { id: "sandbox" },
      { id: "lineBreak" },
      { id: "model", short: true },
      { id: "contextPct" },
      { id: "artifacts" },
      { id: "separator" },
      { id: "quota" },
    ],
  },
  git: {
    id: "git",
    name: "Git focus",
    description: "Project, branch, worktree, stash; changed files and lines, commit",
    widgets: [
      { id: "project" },
      { id: "git" },
      { id: "gitWorktree" },
      { id: "gitStash" },
      { id: "separator" },
      { id: "model", short: true },
      { id: "lineBreak" },
      { id: "gitFiles" },
      { id: "gitChanges" },
      { id: "gitSha" },
      { id: "separator" },
      { id: "contextPct" },
      { id: "quota" },
    ],
  },
  tokens: {
    id: "tokens",
    name: "Token usage",
    description: "Session tokens in and out, cache hit; tokens today and over 7 days",
    widgets: [
      { id: "model", short: true },
      { id: "contextTokens" },
      { id: "separator" },
      { id: "totalTokens", split: true },
      { id: "cacheHit" },
      { id: "lineBreak" },
      { id: "tokensToday" },
      { id: "tokensWeek" },
      { id: "separator" },
      { id: "quota" },
    ],
  },
  quotas: {
    id: "quotas",
    name: "Quota watch",
    description: "Plan and model; 5h and 7d quotas side by side; third-party and Argon",
    widgets: [
      { id: "plan" },
      { id: "separator" },
      { id: "model", short: true },
      { id: "lineBreak" },
      { id: "fiveHourBar" },
      { id: "fiveHourReset" },
      { id: "separator" },
      { id: "weeklyBar" },
      { id: "weeklyReset" },
      { id: "lineBreak" },
      { id: "thirdPartyFiveHour" },
      { id: "thirdPartyWeekly" },
      { id: "separator" },
      { id: "argonWeekly" },
      { id: "argonReset" },
    ],
  },
  full: {
    id: "full",
    name: "Everything",
    description: "Session, project and git; context, tokens and cache; both quotas",
    widgets: [
      { id: "agentState" },
      { id: "tasks" },
      { id: "model" },
      { id: "plan" },
      { id: "sandbox" },
      { id: "separator" },
      { id: "project" },
      { id: "git" },
      { id: "lineBreak" },
      { id: "context" },
      { id: "totalTokens", split: true },
      { id: "cacheHit" },
      { id: "mode" },
      { id: "lineBreak" },
      { id: "fiveHourBar" },
      { id: "fiveHourReset" },
      { id: "separator" },
      { id: "weeklyBar" },
      { id: "weeklyReset" },
    ],
  },
};

const PRESET_ORDER = ["default", "compact", "agent", "git", "tokens", "quotas", "full"];

function applyPreset(baseConfig, presetName) {
  const preset = PRESETS[presetName] || PRESETS.default;
  return mergeConfig({
    ...baseConfig,
    widgets: preset.widgets.map((w) => ({ ...w })),
  });
}

// Apply one-render settings without writing them to the user's config. Invalid
// values are reported by name only so callers can show or log a safe error.
function applyRenderOverrides(baseConfig, overrides = {}) {
  let config = mergeConfig(baseConfig);
  const invalid = [];

  if (overrides.preset !== undefined) {
    const preset =
      typeof overrides.preset === "string" ? overrides.preset.trim().toLowerCase() : "";
    if (Object.hasOwn(PRESETS, preset)) {
      config = applyPreset(config, preset);
    } else {
      invalid.push("preset");
    }
  }

  if (overrides.layout !== undefined) {
    const layout =
      typeof overrides.layout === "string" ? overrides.layout.trim().toLowerCase() : "";
    if (Object.hasOwn(LAYOUTS, layout)) {
      config = mergeConfig({ ...config, layout });
    } else {
      invalid.push("layout");
    }
  }

  if (overrides.theme !== undefined) {
    const theme = canonicalThemeId(overrides.theme);
    // resolveThemeId() falls back to the default theme for an unknown id.
    if (typeof overrides.theme === "string" && resolveThemeId(theme) === theme) {
      config = mergeConfig({ ...config, theme });
    } else {
      invalid.push("theme");
    }
  }

  if (overrides.caps !== undefined) {
    const caps = typeof overrides.caps === "string" ? overrides.caps.trim().toLowerCase() : "";
    if (Object.hasOwn(STYLES, caps)) {
      config = mergeConfig({ ...config, powerline: applyStyle(config.powerline, caps) });
    } else {
      invalid.push("caps");
    }
  }

  if (overrides.gradient !== undefined) {
    const gradient = typeof overrides.gradient === "string" ? overrides.gradient.trim() : "";
    if (gradient.toLowerCase() === "off") {
      const withoutGradient = { ...config };
      delete withoutGradient.gradient;
      config = mergeConfig(withoutGradient);
    } else {
      const normalized = normalizeGradient(gradient);
      if (normalized) {
        config = mergeConfig({ ...config, gradient: normalized });
      } else {
        invalid.push("gradient");
      }
    }
  }

  if (overrides.language !== undefined) {
    const language = matchLanguage(overrides.language);
    if (language) {
      config = mergeConfig({ ...config, language });
    } else {
      invalid.push("language");
    }
  }

  return { config, invalid };
}

module.exports = {
  CONFIG_SCHEMA_URL,
  setConfigDir,
  getConfigDir,
  getConfigPath,
  LAYOUTS,
  LAYOUT_ORDER,
  DEFAULT_THRESHOLDS,
  VALID_WIDGET_IDS,
  resolveLayoutId,
  defaultConfig,
  mergeConfig,
  readConfigFile,
  loadConfig,
  InvalidConfigError,
  saveConfig,
  PRESETS,
  PRESET_ORDER,
  applyPreset,
  applyRenderOverrides,
};
};
__files["formatters.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const os = require("os");
const path = require("path");
const { rgb } = require("./colors");
const { t } = require("./i18n");

function formatReset(seconds, lang) {
  seconds = Number(seconds);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return t("now", lang);
  }

  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}${t("unit_d", lang)} ${hours}${t("unit_h", lang)}`;
  }

  if (hours > 0) {
    return `${hours}${t("unit_hr", lang)} ${minutes}${t("unit_m", lang)}`;
  }

  return `${Math.max(1, minutes)}${t("unit_m", lang)}`;
}

function formatSessionTime(startMs, nowMs = Date.now(), lang) {
  const start = Number(startMs);
  const now = Number(nowMs);
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(now) || now - start < 60000) {
    return "";
  }
  return formatReset((now - start) / 1000, lang);
}

const MONTHS_SHORT = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function parseResetDate(quota) {
  if (!quota) {
    return null;
  }

  if (quota.resetTime) {
    const parsed = Date.parse(quota.resetTime);

    if (Number.isFinite(parsed)) {
      return new Date(parsed);
    }
  }

  const seconds = Number(quota.resetSeconds);

  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(Date.now() + seconds * 1000);
  }

  return null;
}

// Clock settings for exact reset times. hour12 null means "the usual style":
// 12-hour in the built-in format, the locale's own choice when one is set.
// Invalid time zones and locales are dropped (Intl would throw on every
// refresh otherwise).
function normalizeClock(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const hour12 = typeof source.hour12 === "boolean" ? source.hour12 : null;
  const clock = { hour12, timeZone: "", locale: "" };

  if (typeof source.timeZone === "string" && source.timeZone.trim()) {
    try {
      const timeZone = source.timeZone.trim();
      new Intl.DateTimeFormat("en-US", { timeZone });
      clock.timeZone = timeZone;
    } catch {
      // Unknown zone: keep the machine's local time.
    }
  }

  if (typeof source.locale === "string" && source.locale.trim()) {
    try {
      const [locale] = Intl.getCanonicalLocales(source.locale.trim());
      if (locale && Intl.DateTimeFormat.supportedLocalesOf(locale).length) {
        clock.locale = locale;
      }
    } catch {
      // Malformed tag: keep the built-in English format.
    }
  }

  return clock;
}

const dateFormats = new Map();

function dateFormat(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`;
  if (!dateFormats.has(key)) {
    dateFormats.set(key, new Intl.DateTimeFormat(locale, options));
  }
  return dateFormats.get(key);
}

// Hour, minute, month and day as numbers in the configured time zone (or the
// machine's own when none is set).
function clockParts(date, clock) {
  if (!clock.timeZone) {
    return {
      hour: date.getHours(),
      minute: date.getMinutes(),
      month: date.getMonth() + 1,
      day: date.getDate(),
    };
  }

  const parts = {};
  const format = dateFormat("en-US", {
    timeZone: clock.timeZone,
    hourCycle: "h23",
    hour: "numeric",
    minute: "numeric",
    month: "numeric",
    day: "numeric",
  });
  for (const part of format.formatToParts(date)) {
    parts[part.type] = Number(part.value);
  }
  return { hour: parts.hour % 24, minute: parts.minute, month: parts.month, day: parts.day };
}

// Without a locale, times stay in the compact built-in style ("6:33pm",
// "18:33"); with one, Intl formats them the way that locale expects.
function formatClockTime(date, clock = {}) {
  const settings = { hour12: clock.hour12 !== false, timeZone: clock.timeZone || "" };

  if (clock.locale) {
    return dateFormat(clock.locale, {
      timeStyle: "short",
      hour12: typeof clock.hour12 === "boolean" ? clock.hour12 : undefined,
      timeZone: settings.timeZone || undefined,
    }).format(date);
  }

  const { hour, minute } = clockParts(date, settings);
  const minutes = String(minute).padStart(2, "0");

  if (!settings.hour12) {
    return `${String(hour).padStart(2, "0")}:${minutes}`;
  }

  return `${hour % 12 || 12}:${minutes}${hour >= 12 ? "pm" : "am"}`;
}

function formatClockDate(date, clock = {}) {
  if (clock.locale) {
    return dateFormat(clock.locale, {
      month: "short",
      day: "numeric",
      timeZone: clock.timeZone || undefined,
    }).format(date);
  }

  const { month, day } = clockParts(date, { timeZone: clock.timeZone || "" });
  return `${MONTHS_SHORT[month - 1]} ${day}`;
}

function formatResetTime(quota, clock = {}) {
  const date = parseResetDate(quota);
  return date ? formatClockTime(date, clock) : "";
}

function formatResetDatetime(quota, clock = {}) {
  const date = parseResetDate(quota);

  if (!date) {
    return "";
  }

  return `${formatClockDate(date, clock)}, ${formatClockTime(date, clock)}`;
}

const RESET_FORMATS = new Set(["countdown", "time", "both"]);

// Text for a reset widget. 5h resets show a time of day, weekly resets add the
// date. Falls back to the countdown when the payload has no usable reset time.
function formatResetText(quota, { format, fallback, weekly = false, clock = {} } = {}) {
  const chosen = RESET_FORMATS.has(format) ? format : fallback;
  const countdown = quota.reset;

  if (chosen === "countdown") {
    return countdown;
  }

  const exact = weekly ? formatResetDatetime(quota, clock) : formatResetTime(quota, clock);

  if (!exact) {
    return countdown;
  }

  return chosen === "both" ? `${exact} (${countdown})` : exact;
}

// Which meter cell marks how much of the quota window has passed, or -1.
function paceIndex(elapsedPct, width) {
  const pct = Number(elapsedPct);

  if (elapsedPct == null || !Number.isFinite(pct)) {
    return -1;
  }

  return Math.max(0, Math.min(width - 1, Math.floor((pct / 100) * width)));
}

function paceGlyph(ascii) {
  return ascii ? "|" : "┃";
}
function resetInSeconds(quota) {
  const seconds = Number(quota?.reset_in_seconds);

  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds;
  }

  if (quota?.reset_time) {
    const parsed = Date.parse(quota.reset_time);

    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor((parsed - Date.now()) / 1000));
    }
  }

  return 0;
}

function formatTokens(n) {
  n = Number(n);

  if (!Number.isFinite(n) || n < 0) {
    n = 0;
  }

  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }

  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }

  return `${Math.round(n)}`;
}

// "Gemini 3.8 Flash (High)" -> "3.8 Flash·High". Other names only lose a
// trailing "(...)" to the same separator.
function shortModelName(name, ascii = false) {
  return String(name ?? "")
    .replace(/^gemini\s+/i, "")
    .replace(/\s*\(([^)]+)\)\s*$/, ascii ? " $1" : "·$1");
}

// Session input and output tokens: "88.2K↑ 61.1K↓", or "88.2K in 61.1K out".
function formatTokenSplit(input, output, ascii = false, lang) {
  return ascii
    ? `${formatTokens(input)} ${t("tokens_in", lang)} ${formatTokens(output)} ${t("tokens_out", lang)}`
    : `${formatTokens(input)}↑ ${formatTokens(output)}↓`;
}

// The usage widgets' text: "1.2M", or "1.0M↑ 245.3K↓" with "split", plus the
// share of a "budget" when one is set ("1.2M (60%)"). null with no tokens.
function formatUsage(tokens, widget = {}, ascii = false, lang) {
  const input = Number(tokens?.input) || 0;
  const output = Number(tokens?.output) || 0;
  const total = input + output;
  if (!(total > 0)) {
    return null;
  }
  const value = widget?.split ? formatTokenSplit(input, output, ascii, lang) : formatTokens(total);
  const budget = widget?.budget;
  const pct =
    typeof budget === "number" && Number.isFinite(budget) && budget > 0
      ? (total * 100) / budget
      : null;
  return { text: pct === null ? value : `${value} (${Math.round(pct)}%)`, pct };
}

// "used/window", or just the used tokens while the window size is unknown.
function formatContextTokens(used, size) {
  return size > 0 ? `${formatTokens(used)}/${formatTokens(size)}` : formatTokens(used);
}

// Quota widgets: a widget's own warn/crit, else thresholds.quotaWarn/quotaCrit.
function resolveQuotaThresholds(widget = {}, config = {}) {
  return resolveThresholds(widget, config, "quotaWarn", "quotaCrit", 30, 10);
}

// Context widgets: a widget's own warn/crit, else thresholds.contextWarn/contextCrit.
function resolveContextThresholds(widget = {}, config = {}) {
  return resolveThresholds(widget, config, "contextWarn", "contextCrit", 70, 90);
}

function resolveThresholds(widget, config, warnKey, critKey, warnDefault, critDefault) {
  const global = config?.thresholds || {};
  const warn = Number(widget?.warn ?? global[warnKey] ?? warnDefault);
  const crit = Number(widget?.crit ?? global[critKey] ?? critDefault);

  return {
    warn: Number.isFinite(warn) ? warn : warnDefault,
    crit: Number.isFinite(crit) ? crit : critDefault,
    blink: widget?.blink !== undefined ? widget.blink : (global.blink ?? false),
  };
}

// blink: true blinks danger-level widgets, "warn" caution-level ones too.
function shouldBlink(level, blinkOpt) {
  if (blinkOpt === true) {
    return level === "crit";
  }
  if (blinkOpt === "warn") {
    return level === "crit" || level === "warn";
  }
  return false;
}

function quotaColor(remainingPct, healthy, options = {}) {
  const crit = options.crit ?? 10;
  const warn = options.warn ?? 30;
  const critColor = options.critColor || rgb(255, 125, 130);
  const warnColor = options.warnColor || rgb(255, 210, 110);

  if (remainingPct <= crit) {
    return critColor;
  }

  if (remainingPct <= warn) {
    return warnColor;
  }

  return healthy;
}

function contextColor(usedPct, healthy, exceeds200k, options = {}) {
  const crit = options.crit ?? 90;
  const warn = options.warn ?? 70;
  const critColor = options.critColor || rgb(255, 125, 130);
  const warnColor = options.warnColor || rgb(255, 210, 110);

  if (exceeds200k || usedPct >= crit) {
    return critColor;
  }

  if (usedPct >= warn) {
    return warnColor;
  }

  return healthy;
}

function basenameOf(value) {
  if (!value) {
    return "";
  }

  return path.basename(String(value).replace(/[\\/]+$/, ""));
}

function homePath(value) {
  if (!value) {
    return "";
  }

  const input = String(value);
  if (input === "~" || /^~[\\/]/.test(input)) {
    return input;
  }
  const windowsAbsolute = /^[a-z]:[\\/]|^\\\\/i.test(input);
  const posixAbsolute = input.startsWith("/");

  // Payload paths can come from another OS. Preserve absolute paths in that
  // format instead of resolving them relative to this machine's cwd.
  if (
    (windowsAbsolute && process.platform !== "win32") ||
    (posixAbsolute && process.platform === "win32")
  ) {
    return input;
  }

  const resolved = path.resolve(input);
  const home = path.resolve(os.homedir());
  const prefix =
    process.platform === "win32"
      ? resolved.toLowerCase().startsWith(home.toLowerCase())
      : resolved.startsWith(home);

  if (prefix) {
    return "~" + resolved.slice(home.length);
  }

  return resolved;
}

function isValidDepth(value) {
  return Number.isInteger(value) && value >= 1 && value <= 10;
}

// Keep the path's root and final `depth` folders, replacing any middle
// folders with one ellipsis. Accept either OS's path separators on every OS.
function shortenPath(value, depth, ascii = false) {
  const text = String(value ?? "");
  if (!text || !isValidDepth(depth)) {
    return text;
  }

  let root = "";
  let rest = text;
  let separator = text.match(/[\\/]/)?.[0] || "/";
  // A network share keeps \\server\share (or //server/share) as its root.
  const unc = text.match(/^([\\/]{2}[^\\/]+[\\/][^\\/]+)([\\/])?(.*)$/);
  const drive = text.match(/^([a-z]:)([\\/])(.*)$/i);

  if (unc) {
    root = unc[1];
    separator = unc[2] || separator;
    rest = unc[3];
  } else if (drive) {
    root = drive[1];
    separator = drive[2];
    rest = drive[3];
  } else if (text === "~" || /^~[\\/]/.test(text)) {
    root = "~";
    if (text.length > 1) {
      separator = text[1];
      rest = text.slice(2);
    } else {
      rest = "";
    }
  } else if (text[0] === "/" || text[0] === "\\") {
    root = text[0];
    separator = text[0];
    rest = text.slice(1);
  }

  const folders = rest.split(/[\\/]+/).filter(Boolean);
  if (folders.length <= depth) {
    return text;
  }

  const suffix = folders.slice(-depth).join(separator);
  const ellipsis = ascii ? "..." : "…";
  if (root === "/" || root === "\\") {
    return `${root}${ellipsis}${separator}${suffix}`;
  }
  return `${root ? `${root}${separator}` : ""}${ellipsis}${separator}${suffix}`;
}

function label(emojis, emoji, named, value) {
  if (emojis) {
    return named ? ` ${emoji} ${named}: ${value} ` : ` ${emoji} ${value} `;
  }

  return named ? ` ${named}: ${value} ` : ` ${value} `;
}

function charWidth(code) {
  if (
    code === 0x200d ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfe0e ||
    code === 0xfe0f ||
    (code >= 0x1f3fb && code <= 0x1f3ff) ||
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  ) {
    return 0;
  }

  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
    return 0;
  }

  // Miscellaneous Technical, Symbols, Dingbats, and Arrows emojis (e.g. ⌚, ⌛, ⌨, ⏩-⏳, ⏸-⏺, ⭐, ⭕, etc.)
  if (
    code === 0x203c || // ‼️
    code === 0x2049 || // ⁉️
    code === 0x2122 || // ™️
    code === 0x2139 || // ℹ️
    (code >= 0x2194 && code <= 0x2199) || // ↔️-↙️
    (code >= 0x21a9 && code <= 0x21aa) || // ↩️, ↪️
    (code >= 0x231a && code <= 0x231b) || // ⌚, ⌛
    code === 0x2328 || // ⌨
    code === 0x23cf || // ⏏
    (code >= 0x23e9 && code <= 0x23f3) || // ⏩-⏳ (includes ⏰, ⏱, ⏲, ⏳)
    (code >= 0x23f8 && code <= 0x23fa) || // ⏸-⏺
    code === 0x24c2 || // Ⓜ️
    (code >= 0x25aa && code <= 0x25ab) || // ▪️, ▫️
    (code >= 0x25fb && code <= 0x25fe) || // ◻️-◾
    (code >= 0x2600 && code <= 0x27bf) || // Misc symbols & Dingbats (⚡, ⚠, ❌, etc.)
    (code >= 0x2934 && code <= 0x2935) || // ⤴️, ⤵️
    (code >= 0x2b05 && code <= 0x2b07) || // ⬅️-⬇️
    (code >= 0x2b1b && code <= 0x2b1c) || // ⬛, ⬜
    code === 0x2b50 || // ⭐
    code === 0x2b55 || // ⭕
    code === 0x3030 || // 〰️
    code === 0x303d || // 〽️
    code === 0x3297 || // ㊗️
    code === 0x3299 // ㊙️
  ) {
    return 2;
  }

  // East Asian Wide / Fullwidth and Supplementary Ideographic / Emoji planes
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f000 && code <= 0x1ffff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }

  return 1;
}

function visibleWidth(text) {
  const stripped = String(text).replace(
    /\x1b\[[0-9;]*[a-zA-Z]|\x1b\]8;;[^\x1b\x07]*(\x07|\x1b\\)/g,
    ""
  );
  let width = 0;

  for (const char of stripped) {
    width += charWidth(char.codePointAt(0));
  }

  return width;
}

// "+128 −34" as parts, so Lines can color each; zero counts are left out.
function gitChangeParts(changes, ascii = false) {
  const parts = [];
  if (changes?.added > 0) {
    parts.push({ kind: "added", text: `+${changes.added}` });
  }
  if (changes?.removed > 0) {
    parts.push({ kind: "removed", text: `${ascii ? "-" : "−"}${changes.removed}` });
  }
  return parts;
}

const GIT_FILE_MARKS = {
  unicode: { staged: "+", modified: "●", untracked: "?", conflicts: "≠" },
  ascii: { staged: "S", modified: "M", untracked: "?", conflicts: "!" },
};

// "+2 ●3 ?1 ≠1" as parts: staged, modified, untracked, in conflict.
function gitFileParts(files, ascii = false) {
  const marks = GIT_FILE_MARKS[ascii ? "ascii" : "unicode"];
  return Object.keys(marks)
    .filter((kind) => files?.[kind] > 0)
    .map((kind) => ({ kind, text: `${marks[kind]}${files[kind]}` }));
}

function formatGitSync(ahead, behind, ascii = false) {
  const up = ascii ? "^" : "⇡";
  const down = ascii ? "v" : "⇣";
  const a = Number(ahead || 0);
  const b = Number(behind || 0);
  if (a > 0 && b > 0) {
    return `${up}${a} ${down}${b}`;
  }
  if (a > 0) {
    return `${up}${a}`;
  }
  if (b > 0) {
    return `${down}${b}`;
  }
  return "";
}

const GIT_OPERATION_LABELS = {
  rebase: "REBASE",
  am: "AM",
  merge: "MERGING",
  "cherry-pick": "CHERRY-PICKING",
  revert: "REVERTING",
  bisect: "BISECTING",
};

// "REBASE 2/5", "MERGING", or "" with no operation. Plain ASCII in both modes.
function formatGitOperation(op) {
  const name = GIT_OPERATION_LABELS[op?.name];
  if (!name) {
    return "";
  }
  return Number.isInteger(op.step) && Number.isInteger(op.total)
    ? `${name} ${op.step}/${op.total}`
    : name;
}

// "2 subagents, 1 task", or "" when nothing runs.
function formatTasks(subagents, tasks, lang) {
  const part = (n, one, many) => (n > 0 ? `${n} ${t(n === 1 ? one : many, lang)}` : "");
  return [part(subagents, "subagent", "subagents"), part(tasks, "task", "tasks")]
    .filter(Boolean)
    .join(", ");
}

// "accept-edits, NORMAL", or "" in the default mode with Vim editing off.
function formatMode(approval, vim) {
  return [approval === "default" ? "" : approval, vim].filter(Boolean).join(", ");
}

// Cuts text to `max` terminal columns, ending with an ellipsis when cut.
function clipText(text, max, ascii = false) {
  const value = String(text);
  if (visibleWidth(value) <= max) {
    return value;
  }
  const ellipsis = ascii ? "..." : "…";
  let out = "";
  let width = 0;
  let index = 0;
  const escape = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\]8;;[^\x1b\x07]*(?:\x07|\x1b\\))/y;
  while (index < value.length) {
    if (value[index] === "\x1b") {
      escape.lastIndex = index;
      const match = escape.exec(value);
      if (match) {
        out += match[0];
        index += match[0].length;
        continue;
      }
    }

    const code = value.codePointAt(index);
    const char = String.fromCodePoint(code);
    const w = charWidth(code);
    if (width + w > max - ellipsis.length) {
      break;
    }
    out += char;
    width += w;
    index += char.length;
  }
  const clipped = out.trimEnd() + ellipsis;
  return /\x1b\[[0-?]*[ -/]*m/.test(clipped) ? `${clipped}\x1b[0m` : clipped;
}

function isValidMaxWidth(value) {
  return Number.isInteger(value) && value >= 4 && value <= 200;
}

function limitWidth(value, widget, ascii = false, fallback) {
  const width = isValidMaxWidth(widget?.maxWidth)
    ? widget.maxWidth
    : isValidMaxWidth(fallback)
      ? fallback
      : null;
  return width === null ? value : clipText(value, width, ascii);
}

// Removes escape sequences and control characters from text that did not
// come from us (payload fields, branch names, command output), so it cannot
// drive the terminal: cursor moves, OSC 52 clipboard writes, hyperlinks...
function stripControl(text) {
  return (
    String(text ?? "")
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1b[@-_]?/g, "")
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
      // Line/paragraph separators split the bar into extra rows in some
      // terminals, and bidi overrides can make a branch name read as another.
      // Zero-width joiners and plain RTL marks stay: emoji and RTL text need them.
      .replace(/[\u2028\u2029\u202A-\u202E\u2066-\u2069]/g, "")
  );
}

// Payload fields are untrusted in type as well as content. Returns the first
// value that is text (a string or finite number), so an object never prints
// as "[object Object]" or reaches a string method.
function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

// Applies stripControl to every string in a plain object/array tree.
function sanitizeDeep(value, depth = 0) {
  if (typeof value === "string") {
    return stripControl(value);
  }

  if (depth > 8 || value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDeep(item, depth + 1));
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = sanitizeDeep(item, depth + 1);
  }
  return out;
}

module.exports = {
  stripControl,
  firstText,
  sanitizeDeep,
  formatReset,
  formatSessionTime,
  MONTHS_SHORT,
  parseResetDate,
  formatClockTime,
  formatResetTime,
  formatResetDatetime,
  formatClockDate,
  formatResetText,
  normalizeClock,
  paceIndex,
  paceGlyph,
  resetInSeconds,
  formatTokens,
  formatContextTokens,
  shortModelName,
  formatTokenSplit,
  formatUsage,
  formatGitSync,
  formatGitOperation,
  gitChangeParts,
  gitFileParts,
  formatTasks,
  formatMode,
  clipText,
  limitWidth,
  isValidMaxWidth,
  shortenPath,
  isValidDepth,
  quotaColor,
  contextColor,
  resolveQuotaThresholds,
  resolveContextThresholds,
  shouldBlink,
  basenameOf,
  homePath,
  label,
  charWidth,
  visibleWidth,
};
};
__files["git.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const fs = require("fs");
const path = require("path");
const { logWarning } = require("./log");
const { firstText } = require("./formatters");
const { writeFileAtomic, PRIVATE_FILE_MODE } = require("./paths");

// Ahead/behind counts depend only on the two commits compared, so they are
// kept per commit pair: git runs again only when the branch or its upstream
// moves. Starting git costs ~60 ms on Windows, on every refresh otherwise.
const SYNC_CACHE_NAME = ".git-sync-cache.json";
const SYNC_CACHE_MAX = 20;
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

// A git call that runs past its time is skipped until a later refresh. Tests
// give git more time: on a busy CI machine a plain call can take longer.
const timeouts = { sync: 150, detail: 300 };
function setGitTimeouts(next) {
  const previous = { ...timeouts };
  Object.assign(timeouts, next);
  return previous;
}

// Only an absolute folder that exists can belong to the user's session. A
// relative path (a Windows path read on Linux, for one) resolves against
// wherever this process runs, and the upward walk would then report that
// checkout's branch instead of nothing.
function isExistingAbsoluteDir(dir) {
  if (typeof dir !== "string" || !path.isAbsolute(dir)) {
    return false;
  }

  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function findGitDir(cwd) {
  if (!isExistingAbsoluteDir(cwd)) {
    return null;
  }

  let dir = cwd;

  for (let i = 0; i < 24; i++) {
    const gitPath = path.join(dir, ".git");

    try {
      const stat = fs.statSync(gitPath);

      if (stat.isDirectory()) {
        return gitPath;
      }

      if (stat.isFile()) {
        const text = fs.readFileSync(gitPath, "utf8");
        const match = text.match(/^gitdir:\s*(.+)$/m);

        if (match) {
          return path.resolve(dir, match[1].trim());
        }
      }
    } catch {
      // Keep walking up.
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  return null;
}

const GIT_DIRTY_MARKERS = [
  "MERGE_HEAD",
  "REBASE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
];

function gitHasDirtyMarkers(gitDir) {
  return GIT_DIRTY_MARKERS.some((name) => {
    try {
      fs.accessSync(path.join(gitDir, name));
      return true;
    } catch {
      return false;
    }
  });
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

function pathExists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}

const STEP_MAX = 100000;

// The repo controls these files: only a plain whole number in range counts.
function readStep(file) {
  const text = readText(file);
  const n = text !== null && /^\d{1,6}$/.test(text) ? Number(text) : 0;
  return n >= 1 && n <= STEP_MAX ? n : null;
}

// What an unfinished rebase keeps, by backend: [folder, step file, total file].
const REBASE_STATES = [
  ["rebase-merge", "msgnum", "end"],
  ["rebase-apply", "next", "last"],
];

// Checked in this order after a rebase or `git am`; the first one found wins.
const OPERATION_MARKERS = [
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"],
];

// The operation git is in the middle of in this worktree, from files only:
// { name, step, total, folder } or null. A linked worktree keeps these in its
// own git dir, which findGitDir() returns.
function readOperation(gitDir) {
  for (const [folder, stepFile, totalFile] of REBASE_STATES) {
    const dir = path.join(gitDir, folder);
    let name = folder === "rebase-merge" || pathExists(path.join(dir, "rebasing")) ? "rebase" : "";
    if (!name && pathExists(path.join(dir, "applying"))) {
      name = "am";
    }
    if (!name || !pathExists(dir)) {
      continue;
    }
    const step = readStep(path.join(dir, stepFile));
    const total = readStep(path.join(dir, totalFile));
    const counted = step !== null && total !== null;
    return { name, step: counted ? step : null, total: counted ? total : null, folder };
  }

  for (const [file, name] of OPERATION_MARKERS) {
    if (pathExists(path.join(gitDir, file))) {
      return { name, step: null, total: null, folder: "" };
    }
  }

  return null;
}

// A rebase detaches HEAD; the branch being rebased is named in head-name.
function rebasedBranch(gitDir, operation) {
  if (operation?.name !== "rebase") {
    return "";
  }
  const ref = readText(path.join(gitDir, operation.folder, "head-name")) || "";
  const branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
  return isSafeBranchName(branch) ? branch : "";
}

function getGitInfo(cwd) {
  if (!cwd) {
    return null;
  }

  try {
    const gitDir = findGitDir(cwd);

    if (!gitDir) {
      return null;
    }

    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const operation = readOperation(gitDir);
    let branch = "";

    if (head.startsWith("ref: ")) {
      branch = head.replace(/^ref:\s+refs\/heads\//, "").replace(/^ref:\s+/, "");
    } else if (head) {
      branch = rebasedBranch(gitDir, operation) || head.slice(0, 7);
    }

    if (!branch) {
      return null;
    }

    const sync = getGitSync(gitDir, branch);

    return {
      branch,
      dirty: gitHasDirtyMarkers(gitDir),
      ahead: sync.ahead,
      behind: sync.behind,
      operation: operation && {
        name: operation.name,
        step: operation.step,
        total: operation.total,
      },
    };
  } catch {
    return null;
  }
}

// The branch name comes from .git/HEAD, which a repo shipped as an archive
// fully controls. Reject anything git itself would refuse as a ref name, so
// it can neither be parsed as a git option ("-...") nor walk out of refs/
// ("..") when used as a path.
function isSafeBranchName(branch) {
  return (
    typeof branch === "string" &&
    branch.length > 0 &&
    branch.length <= 255 &&
    !branch.startsWith("-") &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".") &&
    !branch.endsWith(".lock") &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.includes("@{") &&
    !/[\x00-\x20\x7f~^:?*[\\]/.test(branch) &&
    !branch.split("/").some((part) => part.startsWith("."))
  );
}

// A linked worktree keeps HEAD in its own folder but refs and config in the
// main repository, named by its "commondir" file.
function commonGitDir(gitDir) {
  try {
    const common = fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim();
    return common ? path.resolve(gitDir, common) : gitDir;
  } catch {
    return gitDir;
  }
}

// Refs are loose files until `git gc` packs them into packed-refs.
function readRef(commonDir, ref) {
  try {
    return fs.readFileSync(path.join(commonDir, ref), "utf8").trim();
  } catch {
    // Not loose: look in packed-refs.
  }

  try {
    const packed = fs.readFileSync(path.join(commonDir, "packed-refs"), "utf8");
    for (const line of packed.split(/\r?\n/)) {
      const [hash, name] = line.trim().split(" ");
      if (name === ref) {
        return hash;
      }
    }
  } catch {
    // No packed-refs either.
  }

  return "";
}

// The ref a branch tracks, read from .git/config ([branch "x"] remote/merge),
// or "" when it tracks nothing.
function upstreamRef(commonDir, branch) {
  let text;
  try {
    text = fs.readFileSync(path.join(commonDir, "config"), "utf8");
  } catch {
    return "";
  }

  let inSection = false;
  let remote = "";
  let merge = "";

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inSection = line === `[branch "${branch}"]`;
      continue;
    }
    if (!inSection) {
      continue;
    }
    const match = line.match(/^(remote|merge)\s*=\s*(.+)$/i);
    if (match && match[1].toLowerCase() === "remote") {
      remote = match[2].trim();
    } else if (match) {
      merge = match[2].trim();
    }
  }

  const tracked = merge.startsWith("refs/heads/") ? merge.slice("refs/heads/".length) : "";

  // Both names come from a config the repo controls and end up in a file path.
  if (!isSafeBranchName(tracked) || (remote !== "." && !isSafeBranchName(remote))) {
    return "";
  }

  // remote = . tracks another local branch.
  return remote === "." ? merge : `refs/remotes/${remote}/${tracked}`;
}

// Only next to a real install's config (like the exec cache); CLI previews
// and other copies don't write it.
function syncCachePath() {
  try {
    const { getConfigDir } = require("./config");
    const dir = getConfigDir();
    return dir && fs.existsSync(path.join(dir, "statusline.config.json"))
      ? path.join(dir, SYNC_CACHE_NAME)
      : null;
  } catch {
    return null;
  }
}

function readSyncCache(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function cachedSync(file, key) {
  const value = file ? readSyncCache(file)[key] : null;
  const valid =
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => Number.isInteger(n) && n >= 0 && n <= 1e7);
  return valid ? { ahead: value[0], behind: value[1] } : null;
}

function saveSync(file, key, sync) {
  if (!file) {
    return;
  }
  try {
    // Newest last; the oldest pairs go once there are more than SYNC_CACHE_MAX.
    const cache = readSyncCache(file);
    delete cache[key];
    cache[key] = [sync.ahead, sync.behind];
    const kept = Object.fromEntries(Object.entries(cache).slice(-SYNC_CACHE_MAX));
    writeFileAtomic(file, JSON.stringify(kept), { mode: PRIVATE_FILE_MODE });
  } catch {
    // Best effort: the next refresh runs git again.
  }
}

function getGitSync(gitDir, branch) {
  if (!gitDir || !isSafeBranchName(branch)) {
    return { ahead: 0, behind: 0 };
  }

  try {
    const commonDir = commonGitDir(gitDir);
    const localHash = readRef(commonDir, `refs/heads/${branch}`);
    const upstream = upstreamRef(commonDir, branch);

    // No commit yet, or nothing tracked: nothing to count and no git to start.
    if (!localHash || !upstream) {
      return { ahead: 0, behind: 0 };
    }

    const upstreamHash = readRef(commonDir, upstream);
    if (upstreamHash === localHash) {
      return { ahead: 0, behind: 0 };
    }

    const key =
      COMMIT.test(localHash) && COMMIT.test(upstreamHash) ? `${localHash}..${upstreamHash}` : "";
    const cacheFile = key ? syncCachePath() : null;
    const cached = cachedSync(cacheFile, key);
    if (cached) {
      return cached;
    }

    const { execFileSync } = require("child_process");
    const out = execFileSync(
      "git",
      // The branch's own upstream: during a rebase HEAD is detached and has none.
      ["rev-list", "--left-right", "--count", `${branch}...${branch}@{upstream}`, "--"],
      {
        cwd: path.dirname(gitDir),
        timeout: timeouts.sync,
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
        // Antigravity may run the statusline without a console; without this,
        // Windows flashes a window for every git call.
        windowsHide: true,
      }
    ).trim();

    const parts = out.split(/\s+/);
    if (parts.length >= 2) {
      const sync = {
        ahead: parseInt(parts[0], 10) || 0,
        behind: parseInt(parts[1], 10) || 0,
      };
      saveSync(cacheFile, key, sync);
      return sync;
    }
  } catch (err) {
    // A timeout or missing git is worth knowing about when ahead/behind
    // counts never show.
    if (err.code === "ETIMEDOUT" || err.signal === "SIGTERM") {
      logWarning("GIT_TIMEOUT", { timeoutMs: timeouts.sync });
    } else if (err.code === "ENOENT") {
      logWarning("GIT_NOT_FOUND");
    }
  }

  return { ahead: 0, behind: 0 };
}

// Working-tree details for the gitChanges, gitFiles, gitSha, gitStash and
// gitWorktree widgets. SHA, stash and worktree come from files; file and line
// counts need `git status` / `git diff`, so those run only for the widgets
// that show them and are reused for STATUS_TTL_MS per repo and commit.
const DETAIL_NEEDS = {
  gitChanges: "diff",
  gitFiles: "status",
  gitSha: "sha",
  gitStash: "stash",
  gitWorktree: "worktree",
};
const STATUS_CACHE_NAME = ".git-status-cache.json";
const STATUS_CACHE_MAX = 20;
const STATUS_TTL_MS = 5000;

// No optional locks: the bar must never hold the index lock and make the
// user's own git commands fail. The -c flags and the submodule skip keep git
// from starting programs named in the repo's own config.
const STATUS_ARGS = [
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
  "status",
  "--porcelain=v2",
  "-z",
  "--ignore-submodules=all",
];
const DIFF_ARGS = [
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "diff",
  "--shortstat",
  "--no-ext-diff",
  "--no-textconv",
  "--ignore-submodules=all",
  "HEAD",
  "--",
];

// A repo opened from an archive controls its own .git/config, and git status
// and diff run the programs it names: filters on changed files, diff drivers,
// fsmonitor hooks, and anything an included file adds. A repo config with any
// of these is read for SHA, stash and worktree only; git itself isn't started.
const RISKY_CONFIG = /^\s*(\[\s*(filter|include|includeif|diff)\b|fsmonitor\s*=)/im;

const statusMemory = new Map();

function hasRiskyRepoConfig(gitDir, commonDir) {
  const files = [path.join(commonDir, "config"), path.join(gitDir, "config.worktree")];
  if (gitDir !== commonDir) {
    files.push(path.join(commonDir, "config.worktree"));
  }
  return files.some((file) => {
    try {
      return RISKY_CONFIG.test(fs.readFileSync(file, "utf8"));
    } catch {
      return false;
    }
  });
}

// The branch checked out and its commit ("" before the first commit).
function readHead(gitDir, commonDir) {
  let head;
  try {
    head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  } catch {
    return { branch: "", commit: "" };
  }
  if (COMMIT.test(head)) {
    return { branch: head.slice(0, 7), commit: head };
  }
  const ref = head.replace(/^ref:\s+/, "");
  const branch = ref.replace(/^refs\/heads\//, "");
  if (!ref.startsWith("refs/heads/") || !isSafeBranchName(branch)) {
    return { branch: "", commit: "" };
  }
  const commit = readRef(commonDir, ref);
  return { branch, commit: COMMIT.test(commit) ? commit : "" };
}

// One line per stash in the stash reflog.
function stashCount(commonDir) {
  try {
    const text = fs.readFileSync(path.join(commonDir, "logs", "refs", "stash"), "utf8");
    return Math.min(text.split("\n").filter((line) => line.trim()).length, 99999);
  } catch {
    return 0;
  }
}

// A linked worktree's git dir is <main>/.git/worktrees/<name>.
function worktreeName(gitDir, commonDir) {
  if (gitDir === commonDir || path.basename(path.dirname(gitDir)) !== "worktrees") {
    return "";
  }
  return path.basename(gitDir);
}

// Porcelain v2 with -z: "1 XY ..." and "2 XY ..." (a rename, followed by its
// old path as its own entry), "u XY ..." for conflicts, "? path" for untracked.
function parseStatus(out) {
  const files = { staged: 0, modified: 0, untracked: 0, conflicts: 0 };
  const entries = String(out).split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const kind = entry[0];
    if (kind === "1" || kind === "2") {
      if (entry[2] !== ".") files.staged++;
      if (entry[3] !== ".") files.modified++;
      if (kind === "2") i++;
    } else if (kind === "u") {
      files.conflicts++;
    } else if (kind === "?") {
      files.untracked++;
    }
  }
  return files;
}

// " 3 files changed, 128 insertions(+), 34 deletions(-)"; nothing when clean.
function parseShortstat(out) {
  const text = String(out);
  const number = (pattern) => parseInt(text.match(pattern)?.[1] ?? "0", 10) || 0;
  return { added: number(/(\d+) insertions?\(\+\)/), removed: number(/(\d+) deletions?\(-\)/) };
}

function runGitDetail(cwd, args) {
  try {
    const { execFileSync } = require("child_process");
    return execFileSync("git", args, {
      cwd,
      timeout: timeouts.detail,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (err) {
    if (err.code === "ETIMEDOUT" || err.signal === "SIGTERM") {
      logWarning("GIT_TIMEOUT", { timeoutMs: timeouts.detail });
    } else if (err.code === "ENOENT") {
      logWarning("GIT_NOT_FOUND");
    }
    return null;
  }
}

function statusCachePath() {
  const sync = syncCachePath();
  return sync ? path.join(path.dirname(sync), STATUS_CACHE_NAME) : null;
}

const DETAIL_FIELDS = {
  files: ["staged", "modified", "untracked", "conflicts"],
  changes: ["added", "removed"],
};

// The cache file can be edited or torn like any file; only whole counts count.
function validDetail(field, cached) {
  const v = cached?.v;
  return (
    typeof cached?.t === "number" &&
    v !== null &&
    typeof v === "object" &&
    DETAIL_FIELDS[field].every(
      (name) => Number.isInteger(v[name]) && v[name] >= 0 && v[name] <= 1e9
    )
  );
}

// A fresh entry is used as is; when git fails, an older one for the same repo
// and commit is still better than nothing.
function cachedDetail(key, field, compute) {
  const now = Date.now();
  const file = statusCachePath();
  let entry = statusMemory.get(key);
  if (!entry?.[field] && file) {
    entry = readSyncCache(file)[key];
  }
  const cached = validDetail(field, entry?.[field]) ? entry[field] : null;
  if (cached && now - cached.t < STATUS_TTL_MS) {
    return cached.v;
  }

  const value = compute();
  if (value === null) {
    return cached?.v ?? null;
  }

  const previous = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  const next = { ...previous, [field]: { t: now, v: value } };
  statusMemory.set(key, next);
  if (file) {
    try {
      const cache = readSyncCache(file);
      delete cache[key];
      cache[key] = next;
      const kept = Object.fromEntries(Object.entries(cache).slice(-STATUS_CACHE_MAX));
      writeFileAtomic(file, JSON.stringify(kept), { mode: PRIVATE_FILE_MODE });
    } catch {
      // Best effort: the next refresh runs git again.
    }
  }
  return value;
}

function getGitDetails(cwd, needs = {}) {
  try {
    const gitDir = findGitDir(cwd);
    if (!gitDir) {
      return null;
    }
    const commonDir = commonGitDir(gitDir);
    const { branch, commit } = readHead(gitDir, commonDir);
    const details = { branch };

    if (needs.sha) {
      details.sha = commit.slice(0, 7);
    }
    if (needs.stash) {
      details.stash = stashCount(commonDir);
    }
    if (needs.worktree) {
      details.worktree = worktreeName(gitDir, commonDir);
    }

    const wantsGit = needs.status || (needs.diff && commit);
    if (wantsGit && hasRiskyRepoConfig(gitDir, commonDir)) {
      logWarning("GIT_CONFIG_SKIPPED");
      return details;
    }

    const key = `${gitDir}\0${commit || "unborn"}`;
    if (needs.status) {
      details.files = cachedDetail(key, "files", () => {
        const out = runGitDetail(cwd, STATUS_ARGS);
        return out === null ? null : parseStatus(out);
      });
    }
    if (needs.diff && commit) {
      details.changes = cachedDetail(key, "changes", () => {
        const out = runGitDetail(cwd, DIFF_ARGS);
        return out === null ? null : parseShortstat(out);
      });
    }
    return details;
  } catch {
    return null;
  }
}

// Only what the configured widgets show is read.
function resolveGitDetails(data, config) {
  const needs = {};
  for (const widget of config?.widgets ?? []) {
    if (DETAIL_NEEDS[widget?.id]) {
      needs[DETAIL_NEEDS[widget.id]] = true;
    }
  }
  if (!Object.keys(needs).length) {
    return null;
  }
  return getGitDetails(firstText(data?.cwd, data?.workspace?.current_dir), needs);
}

function clearGitDetailsCache() {
  statusMemory.clear();
}

// The bar uses vcs.branch and vcs.dirty from Antigravity's payload. Ahead and
// behind are not in it; they come from the local repository.
function vcsFromPayload(data) {
  const vcs = data?.vcs;

  if (!vcs || typeof vcs !== "object") {
    return null;
  }

  return { branch: firstText(vcs.branch), dirty: vcs.dirty === true };
}

function resolveGit(data, config) {
  const wantsGit =
    config?.layout === "lines" || config?.widgets?.some((widget) => widget.id === "git");

  if (!wantsGit) {
    return null;
  }

  const fromPayload = vcsFromPayload(data);
  const local = getGitInfo(firstText(data.cwd, data.workspace?.current_dir));

  if (fromPayload?.branch) {
    // Counts from the local repo only describe the payload's branch if it is
    // the one checked out there.
    const same = local?.branch === fromPayload.branch;
    return {
      ...fromPayload,
      ahead: same ? local.ahead : 0,
      behind: same ? local.behind : 0,
      operation: same ? local.operation : null,
    };
  }

  if (local) {
    return {
      branch: local.branch,
      dirty: Boolean(local.dirty || fromPayload?.dirty),
      ahead: local.ahead,
      behind: local.behind,
      operation: local.operation,
    };
  }

  // No branch from the payload or the folder: nothing to show.
  return null;
}

module.exports = {
  findGitDir,
  getGitInfo,
  readOperation,
  getGitSync,
  isSafeBranchName,
  GIT_DIRTY_MARKERS,
  gitHasDirtyMarkers,
  vcsFromPayload,
  resolveGit,
  SYNC_CACHE_NAME,
  STATUS_CACHE_NAME,
  STATUS_TTL_MS,
  STATUS_ARGS,
  DIFF_ARGS,
  hasRiskyRepoConfig,
  parseStatus,
  parseShortstat,
  getGitDetails,
  resolveGitDetails,
  clearGitDetailsCache,
  setGitTimeouts,
};
};
__files["session.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { formatReset, resetInSeconds, firstText, stripControl } = require("./formatters");
const { resolveGit, resolveGitDetails } = require("./git");
const { resolveUsage, conversationsDir } = require("./usage");
const { isWsl, resolveInstallDir, writeFileAtomic, PRIVATE_FILE_MODE } = require("./paths");
const { logWarning } = require("./log");
const { resolveLanguage, t } = require("./i18n");

const FIVE_HOURS = 5 * 3600;
const SEVEN_DAYS = 7 * 86400;
const ARGON_BUCKET = "gemini-argon-wtu-weekly";
// The buckets Antigravity sends, with the message key of the short name the bar shows.
const QUOTA_BUCKETS = {
  "gemini-5h": { key: "tag_5h", window: FIVE_HOURS },
  "gemini-weekly": { key: "tag_7d", window: SEVEN_DAYS },
  // Gemini 4 Argon on Google AI Pro: a weekly quota of its own, with no 5-hour
  // window, sent whatever model is in use. On Ultra Argon counts toward the
  // Gemini buckets and this one isn't sent.
  [ARGON_BUCKET]: { key: "tag_argon_7d", window: SEVEN_DAYS },
  "3p-5h": { key: "tag_3p_5h", window: FIVE_HOURS },
  "3p-weekly": { key: "tag_3p_7d", window: SEVEN_DAYS },
};
// No quota window lasts a year: a reset further out is a broken value.
const MAX_RESET_SECONDS = 366 * 86400;
const MAX_CONVERSATION_FILES = 2000;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_CACHE_NAME = ".session-cache.json";
const SESSION_CACHE_TTL_MS = 60 * 1000;
const SAMPLE_SESSION_START_MS = Symbol.for("agy-powerline.sampleSessionStartMs");

function sessionCachePath() {
  try {
    const dir = resolveInstallDir();
    return dir && fs.existsSync(path.join(dir, "statusline.config.json"))
      ? path.join(dir, SESSION_CACHE_NAME)
      : null;
  } catch {
    return null;
  }
}

function readSessionCache(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (
      data &&
      typeof data === "object" &&
      (data.startMs === null || Number.isFinite(data.startMs)) &&
      (data.newestMtimeMs === null || Number.isFinite(data.newestMtimeMs)) &&
      Number.isFinite(data.scannedAt)
    ) {
      return data;
    }
  } catch {
    // Missing or invalid cache file.
  }
  return null;
}

function writeSessionCache(file, cache) {
  try {
    writeFileAtomic(file, JSON.stringify(cache), { mode: PRIVATE_FILE_MODE });
  } catch {
    // Write failure is non-fatal.
  }
}

// A scan's result, kept for SESSION_CACHE_TTL_MS. startMs is null when the
// scan found nothing to show, so an idle or unusable folder isn't rescanned on
// every refresh either.
function scanSessionStart(nowMs) {
  const directory = conversationsDir();
  const listing = fs.readdirSync(directory, { withFileTypes: true });
  const entries = listing.filter((entry) => entry.isFile() && entry.name.endsWith(".db"));
  // Only stat the -wal files the listing has: a failed stat costs as much as a
  // real one, and most databases have none.
  const wals = new Set(listing.filter((e) => e.name.endsWith(".db-wal")).map((e) => e.name));

  if (entries.length > MAX_CONVERSATION_FILES) {
    logWarning("SESSION_TOO_MANY_FILES");
    return { startMs: null, newestMtimeMs: null };
  }

  let newest = null;
  for (const entry of entries) {
    const dbPath = path.join(directory, entry.name);
    const stat = fs.statSync(dbPath);
    let mtimeMs = stat.mtimeMs;
    // agy writes to the -wal file first, like signature() in usage.js.
    if (wals.has(`${entry.name}-wal`)) {
      try {
        mtimeMs = Math.max(mtimeMs, fs.statSync(`${dbPath}-wal`).mtimeMs);
      } catch {
        // Removed since the listing.
      }
    }
    if (Number.isFinite(mtimeMs) && (!newest || mtimeMs > newest.mtimeMs)) {
      newest = { mtimeMs, birthtimeMs: stat.birthtimeMs };
    }
  }

  if (!newest) {
    return { startMs: null, newestMtimeMs: null };
  }
  const startMs = newest.birthtimeMs;
  // Some Linux filesystems report no creation time: hide rather than guess.
  const valid =
    Number.isFinite(startMs) && startMs > 0 && startMs <= newest.mtimeMs && startMs <= nowMs;
  return { startMs: valid ? startMs : null, newestMtimeMs: newest.mtimeMs };
}

// Read file metadata only. Conversation database names are IDs and never enter
// the session object, cache or log.
function readSessionStartMs(nowMs = Date.now()) {
  try {
    if (!Number.isFinite(nowMs)) {
      return null;
    }
    const cacheFile = sessionCachePath();
    let result = cacheFile ? readSessionCache(cacheFile) : null;
    if (!result || nowMs - result.scannedAt >= SESSION_CACHE_TTL_MS || result.scannedAt > nowMs) {
      result = { ...scanSessionStart(nowMs), scannedAt: nowMs };
      if (cacheFile) {
        writeSessionCache(cacheFile, result);
      }
    }
    if (result.startMs === null || nowMs - result.newestMtimeMs > SESSION_IDLE_MS) {
      return null;
    }
    return result.startMs;
  } catch {
    // A missing or unreadable conversations folder only hides this widget.
    return null;
  }
}

// Node's platform ids, spelled the way people write them.
const OS_NAMES = {
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux",
  android: "Android",
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
  sunos: "SunOS",
  aix: "AIX",
};

function currentOsName() {
  if (process.platform === "linux" && isWsl()) {
    return "WSL";
  }
  return OS_NAMES[process.platform] || process.platform;
}

function currentUserAndHost() {
  let userInfoName = "";
  try {
    userInfoName = os.userInfo().username;
  } catch {
    // Some containers have no passwd entry for the current user.
  }
  const username =
    [userInfoName, process.env.USER, process.env.USERNAME]
      .map((name) => stripControl(name).trim())
      .find(Boolean) || "";

  let hostname = "";
  try {
    hostname = stripControl(os.hostname()).split(".")[0].trim();
  } catch {
    // The host widget hides when the OS cannot provide a name.
  }
  return { username, hostname };
}

// Payload numbers can be strings, negative or absurd. The bar must never show
// NaN, a negative count or more than 100%.
function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : 0;
}

function percent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

function readQuota(data, key, windowSeconds, lang) {
  const quota = data?.quota?.[key];

  if (!quota || typeof quota !== "object") {
    return null;
  }

  // Without a usable fraction there is nothing to show, not "0% left".
  const fraction = quota.remaining_fraction == null ? NaN : Number(quota.remaining_fraction);

  if (!Number.isFinite(fraction)) {
    return null;
  }

  const remaining = percent(fraction * 100);
  const untilReset = resetInSeconds(quota);
  const resetValid = untilReset <= MAX_RESET_SECONDS;
  const resetSeconds = resetValid ? untilReset : 0;
  const hasReset =
    resetValid &&
    (untilReset > 0 ||
      typeof quota.reset_in_seconds === "number" ||
      Number.isFinite(Date.parse(quota.reset_time)));
  // How far into the quota window we are; the pace marker sits there. A reset
  // further out than the window itself means the window length is unknown.
  const elapsedPct =
    resetSeconds > 0 && resetSeconds <= windowSeconds
      ? ((windowSeconds - resetSeconds) / windowSeconds) * 100
      : null;

  return {
    remaining,
    reset: hasReset ? formatReset(resetSeconds, lang) : "",
    resetSeconds,
    elapsedPct,
    resetTime: resetValid && quota.reset_time ? String(quota.reset_time) : "",
    disabled: quota.disabled === true,
  };
}

// Which quota group a bucket belongs to.
function bucketGroup(key) {
  if (key.startsWith("gemini-argon-")) {
    return "argon";
  }
  if (key.startsWith("gemini-")) {
    return "gemini";
  }
  return key.startsWith("3p-") ? "3p" : null;
}

// The bucket closest to running out for the model in use: the Argon bucket
// for Argon models, the other gemini-* buckets for Gemini models, 3p-*
// (third-party) buckets for the others. Argon falls back to the Gemini
// buckets, where its usage counts when there is no Argon bucket. Without a
// matching bucket every bucket counts. Disabled buckets never do.
function tightestQuota(data, lang) {
  const buckets = data?.quota && typeof data.quota === "object" ? data.quota : {};
  const usable = [];

  for (const key of Object.keys(buckets)) {
    const known = QUOTA_BUCKETS[key];
    const quota = readQuota(data, key, known ? known.window : 0, lang);
    if (quota && !quota.disabled) {
      usable.push({ ...quota, key, label: known ? t(known.key, lang) : key.slice(0, 20) });
    }
  }

  const model = firstText(data?.model?.display_name, data?.model?.id).toLowerCase();
  const inGroup = (group) => usable.filter((quota) => bucketGroup(quota.key) === group);
  let pool;
  if (!model.startsWith("gemini")) {
    pool = inGroup("3p");
  } else if (model.includes("argon")) {
    pool = inGroup("argon");
    pool = pool.length ? pool : inGroup("gemini");
  } else {
    pool = inGroup("gemini");
  }
  pool = pool.length ? pool : usable;

  return pool.reduce((low, quota) => (!low || quota.remaining < low.remaining ? quota : low), null);
}

function contextUsedPercent(data) {
  const used = Number(data.context_window?.used_percentage);

  if (Number.isFinite(used)) {
    return used;
  }

  const remaining = Number(data.context_window?.remaining_percentage);

  if (Number.isFinite(remaining)) {
    return 100 - remaining;
  }

  const size = Number(data.context_window?.context_window_size ?? 0);
  const usage = data.context_window?.current_usage ?? {};
  const current =
    Number(usage.input_tokens ?? 0) +
    Number(usage.cache_creation_input_tokens ?? 0) +
    Number(usage.cache_read_input_tokens ?? 0);

  if (!size || size <= 0) {
    return 0;
  }

  return (current * 100) / size;
}

// options.readUsage: the live statusline may read conversation metadata and
// databases; previews use the usage cache and a synthetic sample start time.
function extractSession(data, config, options = {}) {
  // The bar's own words follow config.language; payload text never changes.
  const lang = resolveLanguage(config?.language);
  const git = resolveGit(data, config);
  const gitDetails = resolveGitDetails(data, config);
  // Once git status has been read for gitFiles, the branch's dirty marker can
  // count uncommitted files too, not only an unfinished merge or rebase.
  const files = gitDetails?.files;
  if (git && files && gitDetails.branch === git.branch) {
    git.dirty = git.dirty || files.staged + files.modified + files.conflicts > 0;
  }
  const contextPct = percent(contextUsedPercent(data));
  const contextSize = count(data.context_window?.context_window_size);
  const current = data.context_window?.current_usage;
  // Context tokens are the used share of the window, so they always agree with
  // the percentage next to them: agy's percentage also counts cached tokens and
  // its own system prompt and tools, which no sum of current_usage reproduces.
  // Without a window size, count what current_usage lists as in the window.
  const usedTokens =
    contextSize > 0
      ? Math.round((contextPct * contextSize) / 100)
      : count(current?.input_tokens) +
        count(current?.cache_read_input_tokens) +
        count(current?.cache_creation_input_tokens);
  const requestTokens = count(current?.input_tokens) + count(current?.output_tokens);

  // RAM is measured here; Antigravity doesn't send it.
  let ramPct = 0;
  try {
    const totalMem = os.totalmem();
    const usedMem = Math.max(0, totalMem - os.freemem());
    ramPct = totalMem > 0 ? Math.round((usedMem * 100) / totalMem) : 0;
  } catch {
    // Leave RAM at 0 when the OS won't say.
  }

  const usage = data.context_window?.current_usage;
  const inputTokens = count(data.context_window?.total_input_tokens);
  const outputTokens = count(data.context_window?.total_output_tokens);
  const sessionTokens = inputTokens + outputTokens;
  const totalTokens = sessionTokens > 0 ? sessionTokens : requestTokens;

  // Share of the prompt served from cache in the latest request.
  const cacheReadTokens = count(usage?.cache_read_input_tokens);
  const cacheTotal = cacheReadTokens + count(usage?.input_tokens);
  const cacheHitPct = cacheTotal > 0 ? Math.round((cacheReadTokens * 100) / cacheTotal) : 0;

  const modelName = firstText(data.model?.display_name, data.model?.id);
  const uses = (id) => Boolean(config?.widgets?.some((widget) => widget?.id === id));
  const osName = uses("os") ? currentOsName() : "";
  const { username, hostname } = uses("host") ? currentUserAndHost() : {};
  let sessionStartMs = null;
  if (uses("sessionTime")) {
    if (options.readUsage === true) {
      sessionStartMs = readSessionStartMs();
    } else if (Number.isFinite(data?.[SAMPLE_SESSION_START_MS])) {
      sessionStartMs = data[SAMPLE_SESSION_START_MS];
    }
  }

  return {
    lang,
    os: osName,
    ramPct,
    username: username || "",
    hostname: hostname || "",
    model: modelName,
    contextPct,
    contextSize,
    usedTokens,
    totalTokens,
    inputTokens,
    outputTokens,
    cacheHitPct,
    // Without a context_window the context widgets hide instead of showing 0/0.
    hasContext: Boolean(data.context_window && typeof data.context_window === "object"),
    // Cache widgets hide without usage from the latest request.
    hasUsage: Boolean(usage && typeof usage === "object"),
    exceeds200k: data.exceeds_200k_tokens === true,
    cacheRead: count(data.context_window?.current_usage?.cache_read_input_tokens),
    cacheCreate: count(data.context_window?.current_usage?.cache_creation_input_tokens),
    fiveHour: readQuota(data, "gemini-5h", FIVE_HOURS, lang),
    weekly: readQuota(data, "gemini-weekly", SEVEN_DAYS, lang),
    thirdPartyFiveHour: readQuota(data, "3p-5h", FIVE_HOURS, lang),
    thirdPartyWeekly: readQuota(data, "3p-weekly", SEVEN_DAYS, lang),
    argonWeekly: readQuota(data, ARGON_BUCKET, SEVEN_DAYS, lang),
    tightestQuota: tightestQuota(data, lang),
    cwd: firstText(data.cwd, data.workspace?.current_dir),
    project: firstText(data.workspace?.project_dir),
    plan: firstText(data.plan_tier),
    agentState: firstText(data.agent_state),
    artifacts: Math.floor(count(data.artifact_count)),
    // Finished subagents stay in the list Antigravity sends; only running ones count.
    subagents: Array.isArray(data.subagents)
      ? data.subagents.filter((agent) => agent?.status === "running").length
      : 0,
    tasks: Math.floor(count(data.task_count)),
    // Left out in the default mode, and with Vim editing off.
    approvalMode: firstText(data.cycle_mode),
    vimMode: firstText(data.vim?.mode),
    // Left out until the conversation has a title; kept to one line.
    title: firstText(data.conversation_title).replace(/\s+/g, " ").trim(),
    sessionStartMs,
    version: firstText(data.version),
    sandbox: data.sandbox?.enabled === true,
    sandboxNet: data.sandbox?.allow_network === true,
    git,
    gitDetails,
    // Only read when tokensToday or tokensWeek is on the bar.
    usage: resolveUsage(config, { read: options.readUsage === true }),
    terminalWidth: terminalWidth(data.terminal_width ?? process.stdout.columns ?? 0),
  };
}

// The flex padding repeats spaces up to this width, so a bogus value (1e12,
// "Infinity") must not reach it. Anything unusable means unknown: no padding.
function terminalWidth(value) {
  const width = Math.floor(Number(value));
  return Number.isFinite(width) && width > 0 ? Math.min(width, 1000) : 0;
}

module.exports = {
  readQuota,
  tightestQuota,
  contextUsedPercent,
  currentUserAndHost,
  readSessionStartMs,
  extractSession,
};
};
__files["paths.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const LOCAL_DIR_NAME = ".agy-powerline";
const GLOBAL_DIR = path.join(os.homedir(), LOCAL_DIR_NAME);
const AGY_SETTINGS = path.join(os.homedir(), ".gemini", "antigravity-cli", "settings.json");

const INSTALL_META_NAME = "install.json";

// Library files the runtime needs (paths relative to src/lib). init joins them
// with src/runtime/statusline.js into the one installed statusline.js.
const RUNTIME_FILES = [
  "shared.js",
  "colors.js",
  "themes.js",
  "config.js",
  "formatters.js",
  "git.js",
  "session.js",
  "paths.js",
  "exec.js",
  "powerline.js",
  "widget-style.js",
  "fit.js",
  "log.js",
  "payload-dump.js",
  "usage.js",
  "i18n.js",
  path.join("layouts", "lines.js"),
  path.join("layouts", "pills.js"),
];

// Files that can hold the user's commands, their output or session details.
// They are written readable by the owner only, so other accounts on a shared
// machine can't read them (Windows profile folders are private already).
const PRIVATE_FILES = [
  "statusline.config.json",
  // The config before the last import (BACKUP_SUFFIX in cli/import.js).
  "statusline.config.json.bak",
  ".exec-cache.json",
  "last-payload.json",
  // SYNC_CACHE_NAME in git.js: commit IDs of the repos you work in.
  ".git-sync-cache.json",
  // STATUS_CACHE_NAME in git.js: repo paths with their file and line counts.
  ".git-status-cache.json",
  // USAGE_CACHE_NAME in usage.js: tokens per day, keyed by a hash of each
  // conversation database's path.
  ".usage-cache.json",
  // SESSION_CACHE_NAME in session.js: start and newest mtime timestamps only.
  ".session-cache.json",
  // LOG_NAME in log.js, spelled out because log.js requires this file.
  "agy-powerline.log",
];
const PRIVATE_FILE_MODE = 0o600;

// Everything init or the runtime may create in the install dir. uninstall
// --delete removes only these, never the whole directory tree. RUNTIME_FILES
// are listed for installs from 1.1.0 and earlier, which copied them separately.
const INSTALLED_FILES = [
  "statusline.js",
  "statusline.cmd",
  INSTALL_META_NAME,
  ...PRIVATE_FILES,
  ...RUNTIME_FILES,
];

function readProcVersion() {
  try {
    return fs.readFileSync("/proc/version", "utf8");
  } catch {
    return "";
  }
}

function isWsl(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;

  if (env.WSL_DISTRO_NAME) {
    return true;
  }

  if (platform !== "linux") {
    return false;
  }

  const procVersion = options.procVersion != null ? options.procVersion : readProcVersion();
  return /microsoft|wsl/i.test(procVersion);
}

function isWindowsNodeOnWsl(options = {}) {
  const execPath = options.execPath || process.execPath;

  if (!isWsl(options)) {
    return false;
  }

  return /^\/mnt\/[a-z]\//i.test(toPosixPath(execPath));
}

function windowsNodeOnWslMessage(execPath = process.execPath) {
  return [
    "This Node binary is the Windows build (a /mnt/c/... path).",
    `  ${execPath}`,
    "Antigravity on Ubuntu/WSL needs Linux Node, or settings will get a Windows command.",
    "Install Node.js 20 or newer inside WSL (for example with nvm), then re-run:",
    "  npm install -g agy-powerline",
    "  agy-powerline init --yes",
  ].join("\n");
}

// Never looks at the current directory: a cloned repo must not be able to
// supply its own config (and exec widgets) to the CLI or the runtime.
function resolveInstallDir() {
  return process.env.AGY_POWERLINE_HOME || GLOBAL_DIR;
}

function safeRealpath(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

// Exec widgets only run from a config the user owns outright: the global
// install dir or an explicit AGY_POWERLINE_HOME. A copy living anywhere else
// (e.g. committed inside a repo) can be changed by whoever controls it.
function isTrustedInstallDir(dir, env = process.env) {
  if (!dir) {
    return false;
  }

  const target = safeRealpath(dir);
  const trusted = [GLOBAL_DIR, env.AGY_POWERLINE_HOME].filter(Boolean);
  const same = (a, b) =>
    process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

  return trusted.some((candidate) => same(safeRealpath(candidate), target));
}

function toPosixPath(value) {
  return String(value).replace(/\\/g, "/");
}

function quoteForSh(value) {
  const posix = toPosixPath(value);
  return `'${posix.replace(/'/g, `'\\''`)}'`;
}

function windowsLauncherPath(installDir) {
  return path.join(installDir, "statusline.cmd");
}

function windowsLauncherBody(nodePath = process.execPath) {
  const node = String(nodePath).replace(/"/g, "").replace(/%/g, "%%");
  return [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    `"${node}" "%~dp0statusline.js" %*`,
    "",
  ].join("\r\n");
}

function writeWindowsLauncher(installDir, nodePath = process.execPath) {
  const dest = windowsLauncherPath(installDir);
  const body = windowsLauncherBody(nodePath);
  try {
    if (fs.existsSync(dest) && fs.readFileSync(dest, "utf8") === body) {
      return;
    }
  } catch {
    // Ignore read error and proceed to write
  }

  try {
    fs.writeFileSync(dest, body, "utf8");
  } catch (err) {
    if (err.code === "EBUSY" && fs.existsSync(dest)) {
      return;
    }
    throw err;
  }
}

function installMetaPath(installDir) {
  return path.join(installDir, INSTALL_META_NAME);
}

function writeInstallMeta(installDir, extra = {}) {
  const body = {
    version: extra.version || require("../../package.json").version,
    node: extra.node || process.execPath,
    platform: extra.platform || process.platform,
    installedAt: extra.installedAt || new Date().toISOString(),
  };
  fs.writeFileSync(installMetaPath(installDir), JSON.stringify(body, null, 2) + "\n", "utf8");
  return body;
}

function readInstallMeta(installDir) {
  try {
    return JSON.parse(fs.readFileSync(installMetaPath(installDir), "utf8"));
  } catch {
    return null;
  }
}

function readAgySettings() {
  try {
    return JSON.parse(fs.readFileSync(AGY_SETTINGS, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

// Reads settings.json for modification. A file that exists but is not plain
// JSON (comments, trailing commas, a typo) is reported instead of being
// treated as empty, so writing back can never drop the user's other settings.
function readSettingsForUpdate(file = AGY_SETTINGS) {
  let text;

  try {
    text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  } catch (err) {
    if (err.code === "ENOENT") {
      return { exists: false, settings: {} };
    }
    return { exists: true, error: err.message };
  }

  if (!text.trim()) {
    return { exists: true, settings: {} };
  }

  try {
    const settings = JSON.parse(text);
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      return { exists: true, error: "top-level value is not a JSON object" };
    }
    return { exists: true, settings };
  } catch (err) {
    return { exists: true, error: err.message };
  }
}

function settingsBackupPath(file = AGY_SETTINGS) {
  return `${file}.agy-powerline.bak`;
}

function settingsOriginalBackupPath(file = AGY_SETTINGS) {
  return `${file}.agy-powerline.original.bak`;
}

// Two copies before every change: the latest file, replaced each time, and
// the file as it was before agy-powerline first changed it, written once and
// never replaced, so running init again can't lose the user's own version.
// Returns the original backup's path when this call created it.
function backUpSettings(file) {
  if (!fs.existsSync(file)) {
    return null;
  }
  const original = settingsOriginalBackupPath(file);
  const created = !fs.existsSync(original);
  if (created) {
    fs.copyFileSync(file, original);
  }
  fs.copyFileSync(file, settingsBackupPath(file));
  return created ? original : null;
}

// Backs up the current file, then writes atomically. Returns what
// backUpSettings() returns.
function writeJsonSafely(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const originalBackup = backUpSettings(file);
  writeFileAtomic(file, JSON.stringify(data, null, 2) + "\n");
  return originalBackup;
}

// Dotfile managers (stow, chezmoi, yadm) link files such as settings.json
// into place. A write goes through the link to the file it points to, so the
// link stays a link and the user's real file gets the change; a rename onto
// the link itself would replace it with a plain file.
function writeTarget(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    // Missing file, or a link whose target doesn't exist yet: follow it once.
    try {
      if (fs.lstatSync(file).isSymbolicLink()) {
        return path.resolve(path.dirname(file), fs.readlinkSync(file));
      }
    } catch {
      // Nothing at that path.
    }
    return file;
  }
}

// Writes via temp file + rename so an interrupted write cannot leave a
// truncated file behind. The new file gets `mode` when given, otherwise the
// mode the existing file had, so rewriting a file never widens who can read
// it (the rename would otherwise reset it to the default).
function writeFileAtomic(file, body, { mode } = {}) {
  const dest = writeTarget(file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  const target = process.platform === "win32" ? undefined : (mode ?? existingMode(dest));
  fs.writeFileSync(tmp, body, { encoding: "utf8", mode: target ?? 0o666 });
  if (target !== undefined) {
    // The mode passed to writeFileSync is reduced by the umask; set it exactly.
    // Some filesystems (e.g. Windows drives under WSL) refuse chmod; the write
    // still matters more.
    try {
      fs.chmodSync(tmp, target);
    } catch {
      // Keep the mode writeFileSync gave it.
    }
  }

  try {
    fs.renameSync(tmp, dest);
  } catch {
    // Windows can refuse to replace a file another process holds open.
    fs.writeFileSync(dest, body, "utf8");
    fs.rmSync(tmp, { force: true });
  }
}

function existingMode(file) {
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return undefined;
  }
}

// Installs made before the private-file change left these files readable by
// everyone; init narrows them. Best effort: a file we can't chmod stays as is.
function restrictPrivateFiles(installDir) {
  if (process.platform === "win32") {
    return;
  }
  for (const name of PRIVATE_FILES) {
    try {
      fs.chmodSync(path.join(installDir, name), PRIVATE_FILE_MODE);
    } catch {
      // Missing file, or not ours to change.
    }
  }
}

// Removes a settings.json that would be left empty. A symlinked one is emptied
// instead: deleting the link would break the user's dotfiles and leave the
// real file unchanged. Returns "deleted", "emptied" or null (nothing there).
function removeSettingsFile(file = AGY_SETTINGS) {
  if (!fs.existsSync(file)) {
    return null;
  }
  backUpSettings(file);
  if (fs.lstatSync(file).isSymbolicLink()) {
    writeFileAtomic(file, "{}\n");
    return "emptied";
  }
  fs.rmSync(file, { force: true });
  return "deleted";
}

// Antigravity runs the Windows launcher through `cmd /c`, which splits the
// command at these characters, so a launcher in such a folder never starts.
// Spaces, %, ! and brackets are fine.
const CMD_BREAKING_CHARS = /[&(^,;=]/g;

function cmdBreakingChars(installDir, platform = process.platform) {
  if (platform !== "win32") {
    return [];
  }
  return [...new Set(String(installDir).match(CMD_BREAKING_CHARS) || [])];
}

function cmdBreakingMessage(chars) {
  const list = chars.map((char) => `"${char}"`).join(", ");
  return [
    `The install folder contains ${list}. Windows splits the statusline command at`,
    "these characters, so Antigravity could not start it. Set AGY_POWERLINE_HOME",
    "permanently to a folder without them (for example: setx AGY_POWERLINE_HOME",
    "C:\\agy-powerline), open a new terminal and run npx agy-powerline init again.",
  ].join("\n  ");
}

function statuslineCommand(installDir, options = {}) {
  const platform = options.platform || process.platform;
  const execPath = options.execPath || process.execPath;
  const script = path.join(installDir, "statusline.js");

  if (platform === "win32") {
    // Antigravity runs `cmd /c <command>` via Go os/exec. Embedded quotes are
    // escaped to \" and cmd then treats them as part of the executable name.
    return toPosixPath(windowsLauncherPath(installDir));
  }

  // Antigravity runs `sh -c <command>` on macOS and Linux. Single quotes keep
  // spaces and $ in the Node or install paths from being expanded.
  return `${quoteForSh(execPath)} ${quoteForSh(script)}`;
}

// The render flags (`--theme light-paper`, see docs/configuration.md) a user
// appended to the command init writes: "" when there are none, null when the
// command is something else.
const RENDER_FLAGS =
  /^(?:\s+--(?:preset|layout|theme|caps|gradient)(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s"'-]\S*))*\s*$/;

function appendedRenderFlags(command, expected) {
  if (typeof command !== "string" || !expected || !command.startsWith(expected)) {
    return null;
  }
  const rest = command.slice(expected.length);
  return RENDER_FLAGS.test(rest) ? rest.trim() : null;
}

module.exports = {
  LOCAL_DIR_NAME,
  GLOBAL_DIR,
  AGY_SETTINGS,
  INSTALL_META_NAME,
  RUNTIME_FILES,
  INSTALLED_FILES,
  PRIVATE_FILES,
  PRIVATE_FILE_MODE,
  restrictPrivateFiles,
  resolveInstallDir,
  isTrustedInstallDir,
  statuslineCommand,
  appendedRenderFlags,
  cmdBreakingChars,
  cmdBreakingMessage,
  windowsLauncherPath,
  writeWindowsLauncher,
  writeInstallMeta,
  readInstallMeta,
  readAgySettings,
  readSettingsForUpdate,
  settingsBackupPath,
  settingsOriginalBackupPath,
  writeJsonSafely,
  writeFileAtomic,
  removeSettingsFile,
  quoteForSh,
  toPosixPath,
  isWsl,
  isWindowsNodeOnWsl,
  windowsNodeOnWslMessage,
};
};
__files["exec.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { stripControl, sanitizeDeep } = require("./formatters");
const { RESET, getActiveDepth } = require("./colors");
const { logWarning } = require("./log");
const { t } = require("./i18n");
const { PRIVATE_FILE_MODE } = require("./paths");

const DEFAULT_TIMEOUT_MS = 500;
const DEFAULT_INTERVAL_SEC = 10;
const MAX_CACHE_AGE_SEC = 3600;
const MAX_OUTPUT_CHARS = 80;

const memoryCache = new Map();

function getCacheFilePath() {
  try {
    const { getConfigDir } = require("./config");
    const dir = getConfigDir();
    if (dir && fs.existsSync(path.join(dir, "statusline.config.json"))) {
      return path.join(dir, ".exec-cache.json");
    }
  } catch {
    // Fallback
  }
  // Per-user name so accounts don't share one cache. Another account could
  // still guess and pre-create it in a shared /tmp, so the runtime never comes
  // here: exec widgets only run from a config file in the install dir above.
  let user = "user";
  try {
    user = os.userInfo().username.replace(/[^A-Za-z0-9_.-]/g, "_") || user;
  } catch {
    // userInfo can throw when the account has no name entry
  }
  return path.join(os.tmpdir(), `agy-powerline-exec-cache-${user}.json`);
}

function loadDiskCache() {
  try {
    const file = getCacheFilePath();
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return typeof data === "object" && data !== null ? data : {};
    }
  } catch {
    // Graceful fallback
  }
  return {};
}

// Several agy windows refresh at once, so the cache is written to a fresh temp
// file and renamed into place: a reader never sees half a file. "wx" refuses a
// file that already exists (or a planted link) in a shared temp folder, and the
// file is owner-only because it holds the output of the user's commands.
function saveDiskCache(cache) {
  let tmp = "";
  try {
    const file = getCacheFilePath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache), {
      encoding: "utf8",
      flag: "wx",
      mode: PRIVATE_FILE_MODE,
    });
    fs.renameSync(tmp, file);
  } catch {
    // The cache is best effort: skip this write rather than risk a torn file.
    try {
      if (tmp) {
        fs.rmSync(tmp, { force: true });
      }
    } catch {
      // Nothing else to do; a stray temp file is harmless.
    }
  }
}

function cacheKey(cmd, cwd = "") {
  return crypto
    .createHash("sha256")
    .update(`${String(cmd).trim()}::${String(cwd).trim()}`)
    .digest("hex")
    .slice(0, 16);
}

// The only escape sequence "colors": true keeps: SGR color and style. Colon
// forms (38:2::r:g:b) are dropped with the rest, since not every terminal reads them.
const SGR_SPLIT = /(\x1b\[[0-9;]*m)/;
const SGR_ALL = /\x1b\[([0-9;]*)m/g;

// Command output is untrusted text: strip terminal control and cap length.
// With colors, SGR sequences survive and the visible text alone is capped;
// the output then ends with a reset so its colors can't leak past it.
function sanitizeExecOutput(text, { colors = false } = {}) {
  if (!colors) {
    const clean = stripControl(text).trim();
    const chars = Array.from(clean);

    if (chars.length <= MAX_OUTPUT_CHARS) {
      return clean;
    }

    return chars.slice(0, MAX_OUTPUT_CHARS - 1).join("") + "…";
  }

  const parts = String(text ?? "")
    .split(SGR_SPLIT)
    .map((part, i) => (i % 2 ? part : stripControl(part)));
  const visible = parts.filter((_, i) => i % 2 === 0).join("");
  const lead = visible.length - visible.trimStart().length;
  const chars = Array.from(visible.trim());
  const cut = chars.length > MAX_OUTPUT_CHARS;
  const budget = cut ? MAX_OUTPUT_CHARS - 1 : chars.length;
  let skip = lead;
  let used = 0;
  let out = "";
  let styled = false;

  for (let i = 0; i < parts.length && used < budget; i++) {
    if (i % 2) {
      out += parts[i];
      styled = true;
      continue;
    }
    for (const char of Array.from(parts[i])) {
      if (skip > 0) {
        skip -= char.length;
        continue;
      }
      if (used === budget) {
        break;
      }
      out += char;
      used++;
    }
  }

  return out + (cut ? "…" : "") + (styled ? RESET : "");
}

// After a reset in colored output, the widget's own colors come back (the
// pill's background and text in Pills), so the rest of the widget isn't left
// in the terminal's default colors.
function restoreAfterReset(text, restore) {
  if (!restore) {
    return text;
  }
  return String(text).replace(SGR_ALL, (seq, body) => {
    const params = body === "" ? [0] : body.split(";").map((p) => (p === "" ? 0 : Number(p)));
    let lastReset = -1;
    for (let i = 0; i < params.length; i++) {
      // 38/48/58 take a color as their next parameters; a 0 there isn't a reset.
      if (params[i] === 38 || params[i] === 48 || params[i] === 58) {
        i += params[i + 1] === 5 ? 2 : params[i + 1] === 2 ? 4 : 0;
      } else if (params[i] === 0) {
        lastReset = i;
      }
    }
    if (lastReset < 0) {
      return seq;
    }
    const rest = params.slice(lastReset + 1);
    return `${RESET}${restore}${rest.length ? `\x1b[${rest.join(";")}m` : ""}`;
  });
}

// Never handed to a command: agy-powerline doesn't read the account email or
// the session and conversation IDs, so it doesn't pass them on either.
const PRIVATE_KEYS = new Set(["email", "session_id", "conversation_id"]);

function withoutPrivateKeys(value, depth = 0) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth > 8) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => withoutPrivateKeys(item, depth + 1));
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (!PRIVATE_KEYS.has(key)) {
      out[key] = withoutPrivateKeys(item, depth + 1);
    }
  }
  return out;
}

// The session JSON an exec widget with "payload": true reads on stdin.
function execPayloadJson(payload) {
  try {
    return JSON.stringify(sanitizeDeep(withoutPrivateKeys(payload ?? {}))) ?? "{}";
  } catch {
    return "{}";
  }
}

// Widgets that share a command but not its options must not share its output.
function widgetCacheKey(widget, cwd) {
  const variant = `${widget.payload === true ? "\0payload" : ""}${widget.colors === true ? "\0colors" : ""}`;
  return cacheKey(`${String(widget.cmd).trim()}${variant}`, cwd);
}

// session.execMode: "run" executes the command, "blocked" marks a config the
// user does not own, anything else (CLI previews) shows a placeholder.
function execWidgetOutput(widget, session = {}) {
  if (!String(widget?.cmd || "").trim()) {
    return "";
  }

  if (session.execMode === "run") {
    // Fitting the bar to the terminal can draw a row several times; a command
    // still runs at most once per refresh, even with "interval": 0.
    const memo = session.execMemo;
    const key = widgetCacheKey(widget, session.cwd || process.cwd());
    if (memo?.has(key)) {
      return memo.get(key);
    }
    const colors = widget.colors === true && getActiveDepth() !== "none";
    const output = sanitizeExecOutput(runExecWidget(widget, session), { colors });
    memo?.set(key, output);
    return output;
  }

  // Placeholders shown instead of running the command.
  return t(session.execMode === "blocked" ? "cmd_blocked" : "cmd_preview", session.lang);
}

function runExecWidget(widget, session = {}) {
  const cmd = String(widget?.cmd || "").trim();
  if (!cmd) {
    return "";
  }

  const cwd = session.cwd || process.cwd();
  const key = widgetCacheKey(widget, cwd);
  const now = Date.now();
  const input = widget.payload === true ? `${session.execPayload || "{}"}\n` : undefined;

  let intervalMs = DEFAULT_INTERVAL_SEC * 1000;
  if (widget.interval != null) {
    const parsed = Number(widget.interval);
    if (Number.isFinite(parsed) && parsed >= 0) {
      intervalMs = parsed * 1000;
    }
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (widget.timeout != null) {
    const parsed = Number(widget.timeout);
    if (Number.isFinite(parsed) && parsed > 0) {
      timeoutMs = Math.min(parsed, 5000);
    }
  }

  // 1. Check memory cache (in-process)
  const memHit = memoryCache.get(key);
  if (memHit && now - memHit.timestamp < intervalMs) {
    return memHit.output;
  }

  // 2. Check disk cache (cross-process, zero-spawn)
  const diskCache = loadDiskCache();
  const diskHit = diskCache[key];
  if (diskHit && now - diskHit.timestamp < intervalMs) {
    memoryCache.set(key, diskHit);
    return diskHit.output;
  }

  // 3. Cache expired or missing: execute command with timeout
  let output = diskHit?.output || memHit?.output || "";
  const firstLine = (stdout) =>
    String(stdout || "")
      .trim()
      .split(/\r?\n/)[0]
      ?.trim() || "";
  try {
    const stdout = execSync(cmd, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    output = firstLine(stdout);
  } catch (err) {
    // A command that exits without reading the whole payload closes the pipe
    // under the write; it still succeeded, so its output counts. Otherwise the
    // previous output stays. A non-zero exit is normal for many commands (grep
    // with no match), so only timeouts and missing commands are logged, and
    // never the command itself.
    if (input !== undefined && err.status === 0 && !err.signal) {
      output = firstLine(err.stdout);
    } else if (err.code === "ETIMEDOUT" || err.signal === "SIGTERM") {
      logWarning("EXEC_TIMEOUT", { timeoutMs });
    } else if (err.status === 127 || err.code === "ENOENT") {
      logWarning("EXEC_COMMAND_NOT_FOUND");
    }
  }

  const entry = { output, timestamp: now };
  memoryCache.set(key, entry);
  diskCache[key] = entry;

  for (const k of Object.keys(diskCache)) {
    if (now - diskCache[k].timestamp > MAX_CACHE_AGE_SEC * 1000) {
      delete diskCache[k];
    }
  }

  saveDiskCache(diskCache);
  return output;
}

function clearExecCache() {
  memoryCache.clear();
  try {
    const file = getCacheFilePath();
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  } catch {
    // Ignore
  }
}

module.exports = {
  runExecWidget,
  execWidgetOutput,
  sanitizeExecOutput,
  restoreAfterReset,
  execPayloadJson,
  widgetCacheKey,
  cacheKey,
  clearExecCache,
  getCacheFilePath,
  loadDiskCache,
  saveDiskCache,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_INTERVAL_SEC,
};
};
__files["powerline.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

// Powerline glyphs are stored as hex code points ("E0B4") so the config file
// stays readable in editors without a Nerd Font. Brackets read well as caps
// but not between two widgets, so round glyphs join with arrows in ASCII.
const GLYPHS = {
  E0B0: { name: "Triangle Right", ascii: ">" },
  E0B2: { name: "Triangle Left", ascii: "<" },
  E0B4: { name: "Round Right", ascii: "]", asciiJoin: ">" },
  E0B6: { name: "Round Left", ascii: "[", asciiJoin: "<" },
  E0B8: { name: "Diagonal \\", ascii: "\\" },
  E0BA: { name: "Diagonal /", ascii: "/" },
  E0BC: { name: "Diagonal /", ascii: "/" },
  E0BE: { name: "Diagonal \\", ascii: "\\" },
};

// What each slot offers in the configure TUI. Left-pointing separators read
// correctly only with inverted colors, so the TUI flips invert for them.
const SLOT_PRESETS = {
  separator: ["E0B0", "E0B2", "E0B4", "E0B6", "E0BC", "E0B8"],
  startCap: ["E0B6", "E0B2", "E0BA", "E0BE"],
  endCap: ["E0B4", "E0B0", "E0BC", "E0B8"],
};

const INVERTED_BY_DEFAULT = new Set(["E0B2", "E0B6"]);

// Custom glyphs have no ASCII twin: separators still need a visible divider,
// caps can simply disappear.
const ASCII_FALLBACK = {
  separator: ">",
  startCap: "",
  endCap: "",
};

const STYLES = {
  round: {
    id: "round",
    name: "Round",
    description: "Rounded capsules with rounded joins (default)",
    separators: ["E0B4"],
    startCaps: ["E0B6"],
    endCaps: ["E0B4"],
  },
  angled: {
    id: "angled",
    name: "Angled / Arrow",
    description: "Traditional Powerline arrows",
    separators: ["E0B0"],
    startCaps: ["E0B2"],
    endCaps: ["E0B0"],
  },
  slanted: {
    id: "slanted",
    name: "Slanted",
    description: "Diagonal cuts at both ends and between widgets",
    separators: ["E0BC"],
    startCaps: ["E0BA"],
    endCaps: ["E0BC"],
  },
  flat: {
    id: "flat",
    name: "Flat / Square",
    description: "Flush rectangular blocks with no caps or joins",
    separators: [],
    startCaps: [],
    endCaps: [],
  },
};

const STYLE_ORDER = ["round", "angled", "slanted", "flat"];

// Bounds a hand-edited config; nobody needs more glyphs than this to cycle.
const MAX_GLYPHS = 16;

// One printable code point only: no control, format, whitespace, combining or
// unassigned characters, so a config file can't smuggle in escape sequences or
// break the width math. Private-use code points (Nerd Font glyphs) are allowed.
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Cn}\p{Z}\p{M}]/u;

function parseGlyph(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/^(?:U\+|0x)?([0-9a-fA-F]{2,6})$/i);
  if (!match) {
    return null;
  }

  const codePoint = parseInt(match[1], 16);
  if (codePoint > 0x10ffff) {
    return null;
  }

  if (UNPRINTABLE.test(String.fromCodePoint(codePoint))) {
    return null;
  }

  return codePoint.toString(16).toUpperCase().padStart(4, "0");
}

function normalizeGlyphList(value, fallback) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return value.map(parseGlyph).filter(Boolean).slice(0, MAX_GLYPHS);
}

function normalizePowerline(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const fallback = STYLES.round;
  const separators = normalizeGlyphList(source.separators, fallback.separators);
  const invert = Array.isArray(source.separatorInvert) ? source.separatorInvert : [];

  return {
    enabled: source.enabled !== false,
    separators,
    separatorInvert: separators.map((_, i) => invert[i] === true),
    startCaps: normalizeGlyphList(source.startCaps, fallback.startCaps),
    endCaps: normalizeGlyphList(source.endCaps, fallback.endCaps),
  };
}

function applyStyle(powerline, styleId) {
  const style = STYLES[styleId];
  if (!style) {
    return normalizePowerline(powerline);
  }

  return normalizePowerline({
    ...powerline,
    separators: style.separators,
    separatorInvert: style.separators.map((hex) => INVERTED_BY_DEFAULT.has(hex)),
    startCaps: style.startCaps,
    endCaps: style.endCaps,
  });
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

// The style whose glyphs match exactly, or null once the user has customized.
function detectStyle(powerline) {
  const current = normalizePowerline(powerline);

  for (const id of STYLE_ORDER) {
    const style = STYLES[id];
    const invert = style.separators.map((hex) => INVERTED_BY_DEFAULT.has(hex));
    if (
      sameList(current.separators, style.separators) &&
      sameList(current.separatorInvert, invert) &&
      sameList(current.startCaps, style.startCaps) &&
      sameList(current.endCaps, style.endCaps)
    ) {
      return id;
    }
  }

  return null;
}

// Cycles through the list; an empty list means no glyph in that slot.
function pickGlyph(list, index) {
  return list.length ? list[index % list.length] : null;
}

function glyphChar(hex, slot, ascii = false) {
  if (!hex) {
    return "";
  }

  if (ascii) {
    const known = GLYPHS[hex];
    if (known) {
      return (slot === "separator" && known.asciiJoin) || known.ascii;
    }
    return ASCII_FALLBACK[slot] ?? "";
  }

  return String.fromCodePoint(parseInt(hex, 16));
}

function glyphName(hex) {
  return GLYPHS[hex]?.name ?? "Custom";
}

module.exports = {
  GLYPHS,
  SLOT_PRESETS,
  INVERTED_BY_DEFAULT,
  STYLES,
  STYLE_ORDER,
  MAX_GLYPHS,
  parseGlyph,
  normalizeGlyphList,
  normalizePowerline,
  applyStyle,
  detectStyle,
  pickGlyph,
  glyphChar,
  glyphName,
};
};
__files["widget-style.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const { parseColor } = require("./colors");
const { clipText, stripControl, visibleWidth } = require("./formatters");
const { DEFAULT_LANGUAGE, t } = require("./i18n");

// Basic names the exec widget's color option always accepted; the Lines
// layout also uses them as its fallback palette.
const NAMED_COLORS = {
  blue: [0, 153, 255],
  orange: [255, 176, 85],
  green: [0, 175, 80],
  cyan: [86, 182, 194],
  red: [255, 85, 85],
  yellow: [230, 200, 0],
  white: [220, 220, 220],
  magenta: [180, 140, 255],
};

// Slots that signal state rather than identity. A widget's own color never
// replaces them, so caution/danger alerts still stand out.
const STATE_SLOTS = new Set(["text", "terminal", "track", "caution", "warn", "gitDirty"]);
const OS_ICONS = { Windows: "🪟", macOS: "🍎", Linux: "🐧", WSL: "🐧" };

// A theme slot ("git"), a basic name ("cyan"), or hex/rgb ("#ff8800").
function resolveColor(value, colors) {
  if (typeof value === "string") {
    const key = value.trim();
    if (colors && Array.isArray(colors[key])) {
      return colors[key];
    }
    if (NAMED_COLORS[key.toLowerCase()]) {
      return NAMED_COLORS[key.toLowerCase()];
    }
  } else if (!Array.isArray(value)) {
    return null;
  }

  return parseColor(value, null);
}

// The theme colors with this widget's color and text color swapped in. Every
// identity slot takes the widget color, so it applies whichever slot the
// widget normally draws with; the theme itself is left untouched.
function widgetColors(widget, colors) {
  const color = resolveColor(widget?.color, colors);
  const text = resolveColor(widget?.textColor, colors);

  if (!color && !text) {
    return colors;
  }

  const out = { ...colors };

  if (color) {
    for (const key of Object.keys(colors)) {
      if (!STATE_SLOTS.has(key) && Array.isArray(colors[key])) {
        out[key] = color;
      }
    }
  }

  if (text) {
    out.text = text;
  }

  return out;
}

// Raw widgets show only their value: no icon, no label.
function isRaw(widget, config) {
  if (widget?.raw === true || widget?.raw === false) {
    return widget.raw;
  }
  return config?.minimalist === true;
}

function isPaced(widget, config) {
  if (widget?.pace === true || widget?.pace === false) {
    return widget.pace;
  }
  return config?.pacing !== false;
}

// Each widget's icon and label, shared by both layouts so Pills and Lines
// read the same. name is the English label (configure shows it), key its
// message in i18n.js. iconOnly: with emojis on, the icon stands in for the label
// (a meter or the model name already says what it is).
const WIDGET_TAGS = {
  model: { icon: "🤖", name: "Model", key: "tag_model", iconOnly: true },
  quota: { icon: "⏳", name: "Quota", key: "tag_quota" },
  fiveHourBar: { icon: "⏳", name: "5h", key: "tag_5h", iconOnly: true },
  fiveHourPct: { icon: "⏳", name: "5h", key: "tag_5h" },
  fiveHourReset: { icon: "🔄", name: "Reset", key: "tag_reset" },
  weeklyBar: { icon: "📅", name: "7d", key: "tag_7d", iconOnly: true },
  weeklyPct: { icon: "📅", name: "7d", key: "tag_7d" },
  weeklyReset: { icon: "🔄", name: "Reset", key: "tag_reset" },
  thirdPartyFiveHour: { icon: "🧪", name: "3P 5h", key: "tag_3p_5h" },
  thirdPartyWeekly: { icon: "🧪", name: "3P 7d", key: "tag_3p_7d" },
  argonWeekly: { icon: "🔮", name: "Argon 7d", key: "tag_argon_7d" },
  argonReset: { icon: "🔄", name: "Argon reset", key: "tag_argon_reset" },
  context: { icon: "💾", name: "Context", key: "tag_context", iconOnly: true },
  contextPct: { icon: "💾", name: "Context", key: "tag_context" },
  contextTokens: { icon: "💾", name: "Context", key: "tag_context" },
  cwd: { icon: "📂", name: "Dir", key: "tag_dir" },
  project: { icon: "📦", name: "Project", key: "tag_project" },
  os: { icon: "💻", name: "" },
  host: { icon: "👤", name: "Host", key: "tag_host", iconOnly: true },
  git: { icon: "🌿", name: "" },
  gitChanges: { icon: "📝", name: "Lines", key: "tag_lines" },
  gitFiles: { icon: "📄", name: "Files", key: "tag_files" },
  gitSha: { icon: "📌", name: "Commit", key: "tag_commit" },
  gitStash: { icon: "💼", name: "Stash", key: "tag_stash" },
  gitWorktree: { icon: "🌳", name: "Worktree", key: "tag_worktree" },
  plan: { icon: "⭐", name: "Plan", key: "tag_plan" },
  agentState: { icon: "🟣", name: "Agent", key: "tag_agent" },
  artifacts: { icon: "📎", name: "Artifacts", key: "tag_artifacts" },
  tasks: { icon: "👥", name: "" },
  mode: { icon: "🧭", name: "" },
  title: { icon: "💬", name: "" },
  sessionTime: { icon: "⏱️", name: "Session", key: "tag_session" },
  ram: { icon: "💻", name: "RAM", key: "tag_ram" },
  version: { icon: "🔖", name: "" },
  sandbox: { icon: "🔒", name: "" },
  cacheRead: { icon: "📥", name: "Cache read", key: "tag_cache_read" },
  cacheCreate: { icon: "📤", name: "Cache create", key: "tag_cache_create" },
  cacheHit: { icon: "⚡", name: "Cache hit", key: "tag_cache_hit" },
  totalTokens: { icon: "🪙", name: "Tokens", key: "tag_tokens" },
  clock: { icon: "🕒", name: "Clock", key: "tag_clock", iconOnly: true },
  tokensToday: { icon: "📈", name: "Today", key: "tag_today" },
  tokensWeek: { icon: "📊", name: "7d", key: "tag_7d" },
  customText: { icon: "🏷️", name: "" },
};

const LABEL_MAX = 20;
const ICON_MAX = 2;

// A widget's own "label": cleaned and cut to LABEL_MAX columns. "" means no
// name; anything that isn't a string leaves the built-in one.
function customLabel(widget, ascii) {
  if (typeof widget?.label !== "string") {
    return undefined;
  }
  return clipText(stripControl(widget.label).trim(), LABEL_MAX, ascii);
}

// A widget's own "icon": "" means none; one wider than ICON_MAX columns is
// ignored, like any other invalid value.
function customIcon(widget) {
  if (typeof widget?.icon !== "string") {
    return undefined;
  }
  const icon = stripControl(widget.icon).trim();
  return visibleWidth(icon) <= ICON_MAX ? icon : undefined;
}

// The text before a widget's value: "🔄 Reset: ", "Reset: ", or nothing for
// raw widgets. icon overrides the table's for state icons (idle agent,
// sandbox with network); the user's own label and icon win over both.
function widgetTag(
  id,
  { emojis = true, raw = false, icon, widget, ascii = false, lang = DEFAULT_LANGUAGE } = {}
) {
  const tag = WIDGET_TAGS[id];
  if (raw || !tag) {
    return "";
  }
  const label = customLabel(widget, ascii);
  const name = label ?? (tag.key ? t(tag.key, lang) : tag.name);
  const named = name ? `${name}: ` : "";
  if (!emojis) {
    return named;
  }
  const shown = customIcon(widget) ?? icon ?? tag.icon;
  // Icon-only widgets hide their built-in name, never one the user chose.
  const after = tag.iconOnly && label === undefined ? "" : named;
  return shown ? `${shown} ${after}` : after;
}

// Meter styles: [filled, empty] glyphs, and a pace marker for a style that
// has its own. cells has none: Pills draws it with background colors. Every
// glyph is one column wide for visibleWidth(); a two-column glyph would
// overflow the meter and throw fitting off.
const METER_STYLES = {
  pips: ["•", "•", "●"],
  cells: null,
  dots: ["●", "●"],
  blocks: ["█", "░"],
  shade: ["▓", "░"],
  line: ["━", "─"],
  geometric: ["▰", "▱"],
  squares: ["■", "□"],
  braille: ["⣿", "⣀"],
  bars: ["▮", "▯"],
  rings: ["●", "○"],
  ramp: ["█", "░"],
};
const METER_STYLE_IDS = Object.keys(METER_STYLES);

function isMeterStyle(value) {
  return typeof value === "string" && Object.hasOwn(METER_STYLES, value);
}

// The widget's "meter", else the global "meterStyle", else the layout's own;
// cells exists only in Pills, so the text layouts draw their own instead.
const OWN_METER = { pills: "pips", lines: "dots", classic: "blocks" };

function meterStyle(widget, config, layout) {
  const own = OWN_METER[layout] ?? OWN_METER.pills;
  const id = [widget?.meter, config?.meterStyle].find(isMeterStyle) ?? own;
  return id === "cells" && layout !== "pills" ? own : id;
}

// Longest conversation title shown, in terminal columns.
const TITLE_MAX = 30;

// RAM use (%) that turns the ram widget to the caution, then danger color.
const RAM_CAUTION = 80;
const RAM_DANGER = 90;

// Widgets whose visibility follows quota or context use the normalized
// session fields below. Reset widgets follow their own quota window.
const QUOTA_WIDGETS = new Set([
  "quota",
  "fiveHourBar",
  "fiveHourPct",
  "weeklyBar",
  "weeklyPct",
  "thirdPartyFiveHour",
  "thirdPartyWeekly",
  "argonWeekly",
]);
const CONTEXT_WIDGETS = new Set(["context", "contextPct", "contextTokens"]);
const RESET_WIDGETS = new Set(["fiveHourReset", "weeklyReset", "argonReset"]);
const SHOW_BELOW_SESSION_KEYS = {
  quota: "tightestQuota",
  fiveHourBar: "fiveHour",
  fiveHourPct: "fiveHour",
  fiveHourReset: "fiveHour",
  weeklyBar: "weekly",
  weeklyPct: "weekly",
  weeklyReset: "weekly",
  thirdPartyFiveHour: "thirdPartyFiveHour",
  thirdPartyWeekly: "thirdPartyWeekly",
  argonWeekly: "argonWeekly",
  argonReset: "argonWeekly",
};
const USAGE_WIDGETS = new Set(["cacheRead", "cacheCreate", "cacheHit"]);

function isVisibilityThreshold(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

// Invalid hand-edited values behave like unset options, leaving the widget
// visible as it was before per-widget visibility thresholds existed.
function hiddenByThreshold(id, widget, session) {
  const quotaKey = Object.hasOwn(SHOW_BELOW_SESSION_KEYS, id) ? SHOW_BELOW_SESSION_KEYS[id] : null;
  if (quotaKey && isVisibilityThreshold(widget?.showBelow)) {
    const remaining = session?.[quotaKey]?.remaining;
    return (
      typeof remaining === "number" && Number.isFinite(remaining) && remaining > widget.showBelow
    );
  }

  // Past 200k tokens the context widgets are in danger: they show whatever
  // the percentage says.
  if (CONTEXT_WIDGETS.has(id) && isVisibilityThreshold(widget?.showAbove)) {
    const used = session?.contextPct;
    return (
      session?.hasContext === true &&
      !session?.exceeds200k &&
      typeof used === "number" &&
      Number.isFinite(used) &&
      used < widget.showAbove
    );
  }

  return false;
}

// Widgets with no data to show hide instead of drawing zeros: no context
// window in the payload is not "0/0", no usage is not "0% cache hit".
function hasNoData(id, session) {
  return (
    (CONTEXT_WIDGETS.has(id) && !session.hasContext) || (USAGE_WIDGETS.has(id) && !session.hasUsage)
  );
}

module.exports = {
  NAMED_COLORS,
  STATE_SLOTS,
  resolveColor,
  widgetColors,
  OS_ICONS,
  WIDGET_TAGS,
  widgetTag,
  LABEL_MAX,
  isRaw,
  isPaced,
  METER_STYLES,
  METER_STYLE_IDS,
  isMeterStyle,
  meterStyle,
  QUOTA_WIDGETS,
  CONTEXT_WIDGETS,
  RESET_WIDGETS,
  isVisibilityThreshold,
  hiddenByThreshold,
  hasNoData,
  RAM_CAUTION,
  RAM_DANGER,
  TITLE_MAX,
};
};
__files["fit.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const { charWidth, visibleWidth } = require("./formatters");

// When a row is wider than the terminal, widgets are dropped in this order,
// first entry first. Ids not listed (custom ones) go before all of them.
const DROP_ORDER = [
  "customText",
  "os",
  "host",
  "gitStash",
  "gitWorktree",
  "title",
  "sessionTime",
  "clock",
  "version",
  "cacheCreate",
  "cacheRead",
  "totalTokens",
  "cacheHit",
  "tokensToday",
  "tokensWeek",
  "artifacts",
  "tasks",
  "plan",
  "ram",
  "project",
  "cwd",
  "exec",
  "agentState",
  "mode",
  "argonReset",
  "thirdPartyWeekly",
  "thirdPartyFiveHour",
  "argonWeekly",
  "weeklyReset",
  "fiveHourReset",
  "contextTokens",
  "gitSha",
  "gitFiles",
  "gitChanges",
  "git",
  "sandbox",
  "weeklyPct",
  "weeklyBar",
  "contextPct",
  "context",
  "fiveHourPct",
  "fiveHourBar",
  "quota",
  "model",
];

const LAYOUT_IDS = new Set(["separator", "lineBreak"]);

// Ends a cut line; ASCII mode uses "..." so it stays plain ASCII.
const ELLIPSIS = { unicode: "…", ascii: "..." };
const RESET = "\x1b[0m";
// One escape sequence: SGR colors, or an OSC 8 hyperlink.
const ESCAPE = /^(\x1b\[[0-9;]*[a-zA-Z]|\x1b\]8;;[^\x1b\x07]*(\x07|\x1b\\))/;

function dropRank(id) {
  return DROP_ORDER.indexOf(id);
}

function splitRows(widgets) {
  const rows = [[]];
  for (const widget of widgets) {
    if (widget.id === "lineBreak") {
      rows.push([]);
    } else {
      rows[rows.length - 1].push(widget);
    }
  }
  return rows;
}

function joinRows(rows) {
  return rows.flatMap((row, i) => (i === 0 ? row : [{ id: "lineBreak" }, ...row]));
}

// A dropped widget can leave separators at the edges or next to each other.
function tidySeparators(row) {
  const out = [];
  for (const widget of row) {
    if (widget.id === "separator" && (!out.length || out[out.length - 1].id === "separator")) {
      continue;
    }
    out.push(widget);
  }
  while (out.length && out[out.length - 1].id === "separator") {
    out.pop();
  }
  return out;
}

// Values only first (labels go, every widget stays), then a short model name
// and short quota meters, then the least useful widgets go one by one until
// the row fits or one widget is left.
function fitRow(row, width, measure) {
  if (measure(row) <= width) {
    return row;
  }

  let current = row.map((widget) =>
    LAYOUT_IDS.has(widget.id) ? widget : { ...widget, raw: true }
  );

  // A shorter model name ("3.8 Flash·High") and shorter meters (12 dots in
  // Lines) before any widget has to go.
  if (measure(current) > width) {
    current = current.map((widget) =>
      widget.id === "model" ? { ...widget, short: true } : { ...widget, compact: true }
    );
  }

  while (measure(current) > width) {
    const content = current.filter((widget) => !LAYOUT_IDS.has(widget.id));
    if (content.length <= 1) {
      break;
    }
    // Lowest rank goes first; on a tie, the rightmost one.
    let victim = content[0];
    for (const widget of content) {
      if (dropRank(widget.id) <= dropRank(victim.id)) {
        victim = widget;
      }
    }
    current = tidySeparators(current.filter((widget) => widget !== victim));
  }

  return current;
}

// measure(rowWidgets) returns the widest line those widgets render to.
function fitWidgets(widgets, width, measure) {
  return joinRows(splitRows(widgets).map((row) => fitRow(row, width, measure)));
}

// Last resort for a single widget wider than the terminal (a very long model
// name or path): cut the line and end it with an ellipsis.
function truncateLine(line, width, ascii = false) {
  if (visibleWidth(line) <= width) {
    return line;
  }

  const ellipsis = ascii ? ELLIPSIS.ascii : ELLIPSIS.unicode;
  const budget = width - ellipsis.length;
  let out = "";
  let used = 0;
  let rest = line;

  while (rest) {
    const escape = rest.match(ESCAPE);
    if (escape) {
      out += escape[0];
      rest = rest.slice(escape[0].length);
      continue;
    }
    const char = String.fromCodePoint(rest.codePointAt(0));
    const charCols = charWidth(char.codePointAt(0));
    if (used + charCols > budget) {
      break;
    }
    out += char;
    used += charCols;
    rest = rest.slice(char.length);
  }

  return out + RESET + ellipsis;
}

function truncateLines(text, width, ascii = false) {
  if (!(width > 0)) {
    return text;
  }
  return text
    .split("\n")
    .map((line) => truncateLine(line, width, ascii))
    .join("\n");
}

function widestLine(text) {
  return Math.max(0, ...String(text).split("\n").map(visibleWidth));
}

module.exports = {
  DROP_ORDER,
  fitWidgets,
  truncateLines,
  widestLine,
};
};
__files["log.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

// Local problem log. It records crashes, exceptions and warnings so a user can
// attach agy-powerline.log to a GitHub issue. It never leaves the machine, and
// it is built from an allowlist: event codes, error types, our own stack
// frames and redacted messages. Payload data, paths, commands and widget text
// are never written.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { writeFileAtomic, readInstallMeta, PRIVATE_FILE_MODE } = require("./paths");
const { stripControl } = require("./formatters");

const LOG_NAME = "agy-powerline.log";
const MAX_ENTRIES = 200;
const MAX_BYTES = 256 * 1024;
const MAX_MESSAGE = 200;
// The statusline runs on every refresh; a repeating problem is counted at
// most once a minute so a broken config doesn't rewrite the file constantly.
const REPEAT_WINDOW_MS = 60 * 1000;

// Code root: src/ in the repo, the install dir for the copied runtime.
const CODE_ROOT = path.basename(__dirname) === "lib" ? path.resolve(__dirname, "..") : __dirname;

const IN_REPO = path.basename(__dirname) === "lib";

let logDir = null;
let context = {};

// The installed statusline.js is the runtime files joined into one (see
// src/cli/bundle.js). [first line, file name] for each of them, so a stack
// frame can still name the original file and line.
let bundleLines = null;

function setBundleLines(lines) {
  bundleLines = Array.isArray(lines) ? lines : null;
}

function originalFrame(rel, line) {
  if (!bundleLines || rel !== "statusline.js") {
    return `${rel}:${line}`;
  }
  let match = null;
  for (const entry of bundleLines) {
    if (entry[0] <= line) {
      match = entry;
    }
  }
  return match ? `${match[1]}:${line - match[0] + 1}` : `${rel}:${line}`;
}

// The copied runtime has no package.json; init records the version in
// install.json instead.
function agyPowerlineVersion() {
  try {
    return IN_REPO
      ? require("../../package.json").version
      : readInstallMeta(CODE_ROOT)?.version || "unknown";
  } catch {
    return "unknown";
  }
}

function isLogEnabled(config, env = process.env) {
  const flag = String(env.AGY_POWERLINE_LOG ?? "")
    .trim()
    .toLowerCase();
  if (["0", "false", "off", "no"].includes(flag)) {
    return false;
  }
  return config?.log !== false;
}

// Turns logging on for this process. Nothing is written until then, so a
// command that never resolved its install dir can't drop a log anywhere.
function setLogDir(dir, enabled = true) {
  logDir = enabled && dir ? dir : null;
}

function getLogPath(dir = logDir) {
  return dir ? path.join(dir, LOG_NAME) : null;
}

// Extra fields for every entry, e.g. the Antigravity version.
function setLogContext(extra) {
  context = { ...context, ...extra };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identity() {
  let user = "";
  try {
    user = os.userInfo().username;
  } catch {
    // Some containers have no passwd entry.
  }
  return { home: os.homedir(), user, host: os.hostname() };
}

// Second line of defense for message text: anything that could identify the
// user or their projects is replaced before it reaches the file.
function redact(text, who = identity()) {
  let out = stripControl(String(text ?? ""));

  for (const home of [who.home, who.home.replace(/\\/g, "/")]) {
    if (home && home.length > 3) {
      out = out.replace(new RegExp(escapeRegExp(home), "gi"), "~");
    }
  }

  out = out
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "<ip>")
    .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, "<ip>")
    // Folder names can be client or project names: any path goes.
    .replace(/(?:[A-Za-z]:|~)?(?:[\\/][^\s\\/'"`]+){2,}[\\/]?/g, "<path>")
    .replace(/(?:[A-Za-z]:|~)[\\/][^\s'"`]*/g, "<path>")
    .replace(/\b[0-9a-f]{20,}\b/gi, "<token>")
    .replace(/[A-Za-z0-9_\-+/=]{32,}/g, "<token>");

  for (const [value, mask] of [
    [who.user, "<user>"],
    [who.host, "<host>"],
  ]) {
    if (value && value.length >= 3) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(value)}\\b`, "gi"), mask);
    }
  }

  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE - 1)}…` : out;
}

// JSON errors quote the text that failed to parse (a config, a payload), so
// only the position is kept.
function jsonErrorMessage(message) {
  const lineCol = /line (\d+) column (\d+)/i.exec(message);
  if (lineCol) {
    return `invalid JSON at line ${lineCol[1]} column ${lineCol[2]}`;
  }
  const position = /position (\d+)/i.exec(message);
  return position ? `invalid JSON at position ${position[1]}` : "invalid JSON";
}

// Only frames from our own files, relative to the code root; Node internals
// and anything else are dropped.
function ourFrames(stack) {
  const frames = [];
  for (const line of String(stack || "").split("\n")) {
    const match = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const file = path.resolve(match[2]);
    const rel = path.relative(CODE_ROOT, file);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !rel.endsWith(".js")) {
      continue;
    }
    const fn = match[1] && /^[\w$.<> ]{1,60}$/.test(match[1]) ? `${match[1]} ` : "";
    frames.push(`${fn}${originalFrame(rel.split(path.sep).join("/"), Number(match[3]))}`);
    if (frames.length >= 8) {
      break;
    }
  }
  return frames;
}

function describeError(err) {
  if (!err || typeof err !== "object") {
    return { message: redact(err) };
  }

  const named = typeof err.name === "string" && /^\w{1,40}$/.test(err.name);
  const out = { type: named ? err.name : "Error" };
  if (typeof err.code === "string" && /^[A-Z0-9_]{1,40}$/.test(err.code)) {
    out.code = err.code;
  }
  out.message =
    err instanceof SyntaxError ? jsonErrorMessage(err.message) : redact(err.message || "");
  const frames = ourFrames(err.stack);
  if (frames.length) {
    out.frames = frames;
  }
  return out;
}

function readLog(file = getLogPath()) {
  if (!file) {
    return [];
  }
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object" && entry.code) {
        entries.push(entry);
      }
    } catch {
      // A hand-edited or truncated line is skipped, not fatal.
    }
  }
  return entries;
}

function minuteStamp(ms) {
  return new Date(ms).toISOString().slice(0, 16) + "Z";
}

function entryKey(entry) {
  return [entry.level, entry.code, entry.message || "", (entry.frames || [])[0] || ""].join("|");
}

// Records one problem. Never throws: a logging failure must not break the bar.
function logEvent(level, code, details = {}) {
  const file = getLogPath();
  if (!file) {
    return;
  }

  try {
    const now = Date.now();
    const usedRam = 1 - os.freemem() / os.totalmem();
    const entry = {
      level,
      code,
      ...details,
      count: 1,
      first: minuteStamp(now),
      last: minuteStamp(now),
      version: agyPowerlineVersion(),
      node: process.version,
      os: `${process.platform}-${process.arch}`,
      ramUsedPct: Number.isFinite(usedRam) ? Math.round(usedRam * 100) : undefined,
      ...context,
    };

    const entries = readLog(file);
    const key = entryKey(entry);
    const existing = entries.find((item) => entryKey(item) === key);

    if (existing) {
      if (now - Date.parse(existing.last) < REPEAT_WINDOW_MS) {
        return;
      }
      existing.count = (Number(existing.count) || 1) + 1;
      existing.last = entry.last;
      entries.splice(entries.indexOf(existing), 1);
      entries.push(existing);
    } else {
      entries.push(entry);
    }

    let lines = entries.slice(-MAX_ENTRIES).map((item) => JSON.stringify(item));
    while (lines.length > 1 && Buffer.byteLength(lines.join("\n")) > MAX_BYTES) {
      lines = lines.slice(1);
    }

    writeFileAtomic(file, lines.join("\n") + "\n", { mode: PRIVATE_FILE_MODE });
  } catch {
    // Read-only disk, full disk, permissions: the bar matters more.
  }
}

function logError(code, err, details = {}) {
  logEvent("error", code, { ...describeError(err), ...details });
}

function logWarning(code, details = {}) {
  logEvent("warn", code, details);
}

function clearLog(dir = logDir) {
  const file = getLogPath(dir);
  if (file) {
    fs.rmSync(file, { force: true });
  }
}

module.exports = {
  LOG_NAME,
  MAX_ENTRIES,
  MAX_BYTES,
  isLogEnabled,
  setLogDir,
  getLogPath,
  setLogContext,
  redact,
  jsonErrorMessage,
  describeError,
  readLog,
  logEvent,
  logError,
  logWarning,
  clearLog,
  setBundleLines,
};
};
__files["payload-dump.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

// Debug payload dumps (AGY_POWERLINE_DEBUG / --dump-payload). Instead of a raw
// copy of what Antigravity sends, the dump keeps only the fields agy-powerline
// renders, so it can be attached to an issue or turned into a test fixture
// as-is. Email, session and conversation IDs are never written; paths and
// branch names become placeholders. A field Antigravity adds later is left
// out until it is listed here.

const path = require("path");
const { stripControl } = require("./formatters");
const { writeFileAtomic, PRIVATE_FILE_MODE } = require("./paths");

const NUMBER = "number";
const BOOL = "boolean";
const TEXT = "text";
const TIME = "time";
const PATH = "path";
const BRANCH = "branch";
const TITLE = "title";

const QUOTA = {
  remaining_fraction: NUMBER,
  reset_time: TIME,
  reset_in_seconds: NUMBER,
  disabled: BOOL,
};
const VCS = { type: TEXT, branch: BRANCH, dirty: BOOL };

const SCHEMA = {
  model: { id: TEXT, display_name: TEXT },
  version: TEXT,
  product: TEXT,
  agent_state: TEXT,
  plan_tier: TEXT,
  cwd: PATH,
  workspace: { current_dir: PATH, project_dir: PATH },
  context_window: {
    total_input_tokens: NUMBER,
    total_output_tokens: NUMBER,
    context_window_size: NUMBER,
    used_percentage: NUMBER,
    remaining_percentage: NUMBER,
    current_usage: {
      input_tokens: NUMBER,
      output_tokens: NUMBER,
      cache_creation_input_tokens: NUMBER,
      cache_read_input_tokens: NUMBER,
    },
  },
  exceeds_200k_tokens: BOOL,
  quota: "quota",
  vcs: VCS,
  sandbox: { enabled: BOOL, allow_network: BOOL },
  artifact_count: NUMBER,
  subagents: "subagents",
  task_count: NUMBER,
  cycle_mode: TEXT,
  vim: { mode: TEXT },
  conversation_title: TITLE,
  terminal_width: NUMBER,
};

// Paths keep their relationship (same folder, subfolder, elsewhere) but none
// of their names.
function pathPlaceholder(value, seen) {
  const key = String(value);
  if (!seen.has(key)) {
    const project = seen.get("__project");
    let placeholder = "/home/user/project";
    if (project && key !== project) {
      const inside = key.startsWith(project + "/") || key.startsWith(project + "\\");
      placeholder = inside ? "/home/user/project/subfolder" : "/home/user/other";
    }
    seen.set(key, placeholder);
  }
  return seen.get(key);
}

// Branch names can hold ticket numbers or client names; the placeholder keeps
// the length, which matters for width bugs.
function branchPlaceholder(value) {
  const length = Math.min(100, Math.max(6, String(value).length));
  return "branch" + "x".repeat(length - 6);
}

function pick(value, rule, seen) {
  if (value == null) {
    return undefined;
  }

  if (rule === NUMBER) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
  if (rule === BOOL) {
    return typeof value === "boolean" ? value : undefined;
  }
  if (rule === TEXT) {
    return typeof value === "string" ? stripControl(value).slice(0, 80) : undefined;
  }
  if (rule === TIME) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
  }
  if (rule === PATH) {
    return typeof value === "string" && value ? pathPlaceholder(value, seen) : undefined;
  }
  if (rule === BRANCH) {
    return typeof value === "string" && value ? branchPlaceholder(value) : undefined;
  }
  if (rule === TITLE) {
    // A title can name the user's work; the placeholder keeps its length.
    return typeof value === "string" && value
      ? "title" + "x".repeat(Math.max(0, Math.min(200, value.length) - 5))
      : undefined;
  }
  if (rule === "subagents") {
    // Only the status: a subagent's name and role describe the user's work.
    return Array.isArray(value)
      ? value.slice(0, 50).map((agent) => pick(agent, { status: TEXT }, seen) || {})
      : undefined;
  }
  if (rule === "quota") {
    if (typeof value !== "object") {
      return undefined;
    }
    const out = {};
    for (const [key, quota] of Object.entries(value)) {
      if (/^[\w.-]{1,40}$/.test(key)) {
        out[key] = pick(quota, QUOTA, seen);
      }
    }
    return out;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out = {};
  for (const [key, child] of Object.entries(rule)) {
    const picked = pick(value[key], child, seen);
    if (picked !== undefined) {
      out[key] = picked;
    }
  }
  return out;
}

function safePayload(data) {
  const seen = new Map();
  // The project folder anchors the other path placeholders.
  const project = data?.workspace?.project_dir;
  if (typeof project === "string" && project) {
    seen.set("__project", project);
  }
  return pick(data, SCHEMA, seen) || {};
}

// AGY_POWERLINE_DUMP_PAYLOAD names the dump file. The statusline runs in the
// user's project folder, so a relative name resolves in the install dir
// instead, never next to the user's code.
function dumpTarget(value, installDir) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return path.resolve(installDir, value.trim());
}

// Writes the dump for the raw stdin text. Unparseable input is recorded as
// such (with the position only), never copied.
function writePayloadDump(target, rawInput) {
  let body;
  try {
    body = safePayload(JSON.parse(rawInput));
  } catch (err) {
    const position = /position (\d+)/i.exec(String(err.message));
    body = { invalid_json: true, position: position ? Number(position[1]) : undefined };
  }

  try {
    writeFileAtomic(path.resolve(target), JSON.stringify(body, null, 2) + "\n", {
      mode: PRIVATE_FILE_MODE,
    });
  } catch {
    // Best-effort debug write; the bar matters more.
  }
}

module.exports = {
  dumpTarget,
  safePayload,
  writePayloadDump,
};
};
__files["usage.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

// Tokens used today and over the last 7 days, for the tokensToday and
// tokensWeek widgets. agy keeps each conversation in a SQLite database of its
// own; only the usage numbers, response IDs (to drop duplicates) and
// timestamps are read from it, never a message, a model prompt or a name.
// The field numbers and the way duplicates are dropped follow ccusage's
// Antigravity adapter (MIT, rust/adapters/antigravity/src/parser.rs).

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { logWarning } = require("./log");
const { writeFileAtomic, PRIVATE_FILE_MODE } = require("./paths");

const USAGE_CACHE_NAME = ".usage-cache.json";
// Reading databases stops for this refresh past this budget; the cache keeps
// the totals and the rest is read on the next refresh.
const READ_BUDGET_MS = 100;
const DAY_MS = 86400000;
// How many days back each widget looks, today included.
const USAGE_PERIODS = { tokensToday: 1, tokensWeek: 7 };
// Usage metadata is a few hundred bytes; anything this big isn't.
const MAX_BLOB_BYTES = 4 * 1024 * 1024;
const MAX_DEPTH = 8;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Database opens, so tests can check that unchanged files aren't read again.
const stats = { opens: 0 };
let memoryCache = null;
let sqlite;

// node:sqlite is built into Node 22.13 / 23.4 and newer. Node 22 prints an
// ExperimentalWarning on stderr when it loads, which must not reach the bar's
// stderr: that one warning is swallowed while it loads, every other one goes on.
function loadSqlite() {
  if (sqlite !== undefined) {
    return sqlite;
  }
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type;
    const name = type || warning?.name;
    if (name === "ExperimentalWarning" && /sqlite/i.test(String(warning?.message ?? warning))) {
      return undefined;
    }
    return emitWarning.call(this, warning, ...rest);
  };
  try {
    sqlite = require("node:sqlite");
  } catch {
    sqlite = null;
  } finally {
    process.emitWarning = emitWarning;
  }
  return sqlite;
}

function usageAvailable() {
  return Boolean(loadSqlite()?.DatabaseSync);
}

// A minimal protobuf reader: varints and length-delimited fields, fixed-width
// fields skipped. Truncated or oversized input, groups and nesting deeper
// than MAX_DEPTH throw; the database is then skipped for this refresh.
function readVarint(buf, pos) {
  let value = 0;
  for (let shift = 0; shift < 64; shift += 7) {
    if (pos >= buf.length) {
      throw new Error("truncated varint");
    }
    const byte = buf[pos++];
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) {
      return [value, pos];
    }
  }
  throw new Error("varint too long");
}

function decodeMessage(buf, depth = 0) {
  if (depth > MAX_DEPTH) {
    throw new Error("message nested too deep");
  }
  if (!(buf instanceof Uint8Array) || buf.length > MAX_BLOB_BYTES) {
    throw new Error("not a protobuf message");
  }
  const fields = new Map();
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    let value;
    if (wire === 0) {
      [value, pos] = readVarint(buf, pos);
    } else if (wire === 2) {
      let length;
      [length, pos] = readVarint(buf, pos);
      if (pos + length > buf.length) {
        throw new Error("truncated field");
      }
      value = buf.subarray(pos, pos + length);
      pos += length;
    } else if (wire === 1 || wire === 5) {
      pos += wire === 1 ? 8 : 4;
      if (pos > buf.length) {
        throw new Error("truncated field");
      }
      continue;
    } else {
      throw new Error("unsupported wire type");
    }
    if (field < 1) {
      throw new Error("bad field number");
    }
    if (!fields.has(field)) {
      fields.set(field, []);
    }
    fields.get(field).push(value);
  }
  return { fields, depth };
}

function nested(msg, field) {
  return (msg?.fields.get(field) ?? [])
    .filter((value) => value instanceof Uint8Array)
    .map((value) => decodeMessage(value, msg.depth + 1));
}

function child(msg, field) {
  return nested(msg, field)[0] ?? null;
}

function number(msg, field) {
  const value = msg?.fields.get(field)?.[0];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(msg, field) {
  const value = msg?.fields.get(field)?.[0];
  return value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : "";
}

// Timestamp message: 1 = seconds, 2 = nanoseconds.
function timestamp(msg) {
  const seconds = number(msg, 1);
  return seconds > 0 ? seconds * 1000 + Math.floor(number(msg, 2) / 1e6) : null;
}

// ModelUsage: 2 = input, 3 = total output; 11, 12 and 7 = response, provider
// message and message IDs, the first one present names the response.
function usageEntry(msg, ts) {
  if (!msg) {
    return null;
  }
  return {
    input: number(msg, 2),
    output: number(msg, 3),
    id: text(msg, 11) || text(msg, 12) || text(msg, 7),
    ts,
  };
}

// gen_metadata.data: GeneratorMetadata. 1 = chat-model message, whose 4 is
// the usage, 17 the retries (each with its usage in 2) and 9 the generation
// info (timestamp in 4).
function generatorEntries(data) {
  const chat = child(decodeMessage(data), 1);
  const ts = timestamp(child(child(chat, 9), 4));
  return [
    usageEntry(child(chat, 4), ts),
    ...nested(chat, 17).map((r) => usageEntry(child(r, 2), ts)),
  ];
}

// steps.metadata: CortexStepMetadata. 9 = usage, 28 = retries (usage in 2),
// 8 or else 1 = timestamp.
function stepEntries(data) {
  const step = decodeMessage(data);
  const ts = timestamp(child(step, 8)) ?? timestamp(child(step, 1));
  return [
    usageEntry(child(step, 9), ts),
    ...nested(step, 28).map((r) => usageEntry(child(r, 2), ts)),
  ];
}

function blob(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!(value instanceof Uint8Array)) {
    throw new Error("not a blob");
  }
  return value;
}

const dayFormats = new Map();

// "2026-10-18" for a moment, in the time zone given (the machine's own when "").
function dayKey(ms, timeZone = "") {
  if (!dayFormats.has(timeZone)) {
    dayFormats.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone: timeZone || undefined,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    );
  }
  const parts = {};
  for (const part of dayFormats.get(timeZone).formatToParts(new Date(ms))) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Today and the days before it, `count` in all. Half-day steps never skip a
// day, even across a daylight saving change.
function recentDays(now, count, timeZone) {
  const keys = new Set();
  for (let t = now; keys.size < count; t -= DAY_MS / 2) {
    keys.add(dayKey(t, timeZone));
  }
  return [...keys];
}

// Input and output tokens per day in one conversation database.
function readDatabase(file, timeZone, fallbackMs) {
  const db = new sqlite.DatabaseSync(file, { readOnly: true });
  stats.opens += 1;
  try {
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name)
    );
    if (!tables.has("gen_metadata")) {
      throw new Error("no gen_metadata table");
    }

    // The conversation's own time, for rows that carry none.
    let conversationTs = null;
    if (tables.has("trajectory_metadata_blob")) {
      for (const row of db.prepare("SELECT data FROM trajectory_metadata_blob").all()) {
        const data = blob(row.data);
        conversationTs = (data && timestamp(child(decodeMessage(data), 2))) ?? conversationTs;
      }
    }

    const entries = [];
    for (const row of db.prepare("SELECT idx, data FROM gen_metadata ORDER BY idx ASC").all()) {
      const data = blob(row.data);
      if (data) {
        entries.push(...generatorEntries(data));
      }
    }
    if (tables.has("steps")) {
      for (const row of db.prepare("SELECT idx, metadata FROM steps ORDER BY idx ASC").all()) {
        const data = blob(row.metadata);
        if (data) {
          entries.push(...stepEntries(data));
        }
      }
    }

    // The same response can be in both tables and among the retries.
    const seen = new Set();
    const days = {};
    for (const entry of entries) {
      if (!entry || entry.input + entry.output <= 0) {
        continue;
      }
      if (entry.id) {
        if (seen.has(entry.id)) {
          continue;
        }
        seen.add(entry.id);
      }
      const day = dayKey(entry.ts ?? conversationTs ?? fallbackMs, timeZone);
      days[day] = days[day] || { input: 0, output: 0 };
      days[day].input += entry.input;
      days[day].output += entry.output;
    }
    return days;
  } finally {
    db.close();
  }
}

function conversationsDir() {
  return path.join(os.homedir(), ".gemini", "antigravity-cli", "conversations");
}

// agy may still have recent writes in the -wal file next to the database.
function signature(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) {
      return null;
    }
    let mtimeMs = stat.mtimeMs;
    let size = stat.size;
    try {
      const wal = fs.statSync(`${file}-wal`);
      mtimeMs = Math.max(mtimeMs, wal.mtimeMs);
      size += wal.size;
    } catch {
      // No write-ahead log.
    }
    return { mtimeMs, size };
  } catch {
    return null;
  }
}

// The file name is a conversation ID: the cache only keeps a hash of the path.
function fileKey(file) {
  return crypto.createHash("sha256").update(file).digest("hex").slice(0, 16);
}

// Only next to a real install's config, like the git caches.
function cachePath() {
  try {
    const { getConfigDir } = require("./config");
    const dir = getConfigDir();
    return dir && fs.existsSync(path.join(dir, "statusline.config.json"))
      ? path.join(dir, USAGE_CACHE_NAME)
      : null;
  } catch {
    return null;
  }
}

function validDays(days) {
  return (
    days !== null &&
    typeof days === "object" &&
    !Array.isArray(days) &&
    Object.entries(days).every(
      ([day, tokens]) =>
        DAY_KEY.test(day) &&
        ["input", "output"].every(
          (key) => Number.isFinite(tokens?.[key]) && tokens[key] >= 0 && tokens[key] <= 1e15
        )
    )
  );
}

function validEntry(entry) {
  return Number.isFinite(entry?.mtimeMs) && Number.isFinite(entry?.size) && validDays(entry.days);
}

// The cache file can be edited or torn like any file: bad entries are dropped.
function readCache(file) {
  let data = memoryCache;
  if (file) {
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      data = null;
    }
  }
  const files = {};
  if (data?.files && typeof data.files === "object") {
    for (const [key, entry] of Object.entries(data.files)) {
      if (/^[0-9a-f]{16}$/.test(key) && validEntry(entry)) {
        files[key] = entry;
      }
    }
  }
  return { tz: typeof data?.tz === "string" ? data.tz : "", files };
}

function saveCache(file, cache) {
  memoryCache = cache;
  if (!file) {
    return;
  }
  try {
    writeFileAtomic(file, JSON.stringify(cache), { mode: PRIVATE_FILE_MODE });
  } catch {
    // Best effort: the next refresh reads the databases again.
  }
}

// Reads the databases changed since the cache was written, within the time
// budget. Returns whether the cache changed.
function refresh(cache, periodDays, timeZone) {
  let names;
  try {
    names = fs.readdirSync(conversationsDir());
  } catch {
    names = [];
  }

  const now = Date.now();
  // A day of margin for time zones.
  const cutoff = now - (periodDays + 1) * DAY_MS;
  const files = {};
  let changed = false;

  for (const name of names) {
    if (!name.endsWith(".db")) {
      continue;
    }
    const file = path.join(conversationsDir(), name);
    const sig = signature(file);
    if (!sig || sig.mtimeMs < cutoff) {
      continue;
    }
    const key = fileKey(file);
    const old = cache.files[key];
    if (old && old.mtimeMs === sig.mtimeMs && old.size === sig.size) {
      files[key] = old;
      continue;
    }
    if (Date.now() - now > READ_BUDGET_MS) {
      if (old) {
        files[key] = old;
      }
      continue;
    }
    try {
      files[key] = { ...sig, days: readDatabase(file, timeZone, sig.mtimeMs) };
      changed = true;
    } catch (err) {
      // Busy, locked, not agy's format: skipped until it changes again. No
      // path or ID in the log.
      const code = typeof err?.code === "string" && /^[A-Z_]{1,40}$/.test(err.code) ? err.code : "";
      logWarning("USAGE_DB_UNREADABLE", code ? { code } : {});
      if (old) {
        files[key] = old;
      }
    }
  }

  changed = changed || Object.keys(files).length !== Object.keys(cache.files).length;
  cache.files = files;
  return changed;
}

function sum(cache, days) {
  const total = { input: 0, output: 0 };
  for (const entry of Object.values(cache.files)) {
    for (const day of days) {
      total.input += entry.days[day]?.input ?? 0;
      total.output += entry.days[day]?.output ?? 0;
    }
  }
  return total;
}

function machineZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

// { today, week } tokens ({ input, output } each), or null when no usage
// widget is on the bar or node:sqlite is missing. Only the statusline itself
// reads databases (read: true); previews use what the cache holds.
function resolveUsage(config, { read = false } = {}) {
  const periodDays = Math.max(
    0,
    ...(config?.widgets ?? []).map((widget) => USAGE_PERIODS[widget?.id] ?? 0)
  );
  if (!periodDays) {
    return null;
  }

  try {
    const timeZone = config?.clock?.timeZone || "";
    // Days are counted in this zone, so a cache made in another one is stale.
    const zone = timeZone || machineZone();
    const file = cachePath();
    let cache = readCache(file);
    if (cache.tz !== zone) {
      cache = { tz: zone, files: {} };
    }

    if (read) {
      if (!usageAvailable()) {
        return null;
      }
      if (refresh(cache, periodDays, timeZone)) {
        saveCache(file, cache);
      }
    }

    const now = Date.now();
    return {
      today: sum(cache, recentDays(now, 1, timeZone)),
      week: sum(cache, recentDays(now, 7, timeZone)),
    };
  } catch {
    return null;
  }
}

function clearUsageCache() {
  memoryCache = null;
}

module.exports = {
  USAGE_CACHE_NAME,
  USAGE_PERIODS,
  READ_BUDGET_MS,
  stats,
  loadSqlite,
  usageAvailable,
  decodeMessage,
  dayKey,
  recentDays,
  conversationsDir,
  resolveUsage,
  clearUsageCache,
};
};
__files["i18n.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

// The bar's own words: widget tags, captions and units. Payload text (model,
// branch, paths, agent state), git operation names, numbers and dates are
// never translated; dates follow clock.locale instead.
const MESSAGES = {
  en: {
    tag_model: "Model",
    tag_quota: "Quota",
    tag_5h: "5h",
    tag_7d: "7d",
    tag_reset: "Reset",
    tag_3p_5h: "3P 5h",
    tag_3p_7d: "3P 7d",
    tag_argon_7d: "Argon 7d",
    tag_argon_reset: "Argon reset",
    tag_context: "Context",
    tag_dir: "Dir",
    tag_project: "Project",
    tag_host: "Host",
    tag_lines: "Lines",
    tag_files: "Files",
    tag_commit: "Commit",
    tag_stash: "Stash",
    tag_worktree: "Worktree",
    tag_plan: "Plan",
    tag_agent: "Agent",
    tag_artifacts: "Artifacts",
    tag_session: "Session",
    tag_ram: "RAM",
    tag_cache_read: "Cache read",
    tag_cache_create: "Cache create",
    tag_cache_hit: "Cache hit",
    tag_tokens: "Tokens",
    tag_clock: "Clock",
    tag_today: "Today",

    rem: "rem",
    over_200k: ">200k",
    now: "now",
    unit_d: "d",
    unit_h: "h",
    unit_hr: "hr",
    unit_m: "m",
    subagent: "subagent",
    subagents: "subagents",
    task: "task",
    tasks: "tasks",
    tokens_in: "in",
    tokens_out: "out",
    sandbox_net: "sandbox (net)",
    sandbox_isolated: "sandbox (isolated)",
    cmd_preview: "[cmd]",
    cmd_blocked: "[blocked]",
  },
  fr: {
    tag_model: "Modèle",
    tag_quota: "Quota",
    tag_5h: "5h",
    tag_7d: "7j",
    tag_reset: "Réinit",
    tag_3p_5h: "Tiers 5h",
    tag_3p_7d: "Tiers 7j",
    tag_argon_7d: "Argon 7j",
    tag_argon_reset: "Réinit Argon",
    tag_context: "Contexte",
    tag_dir: "Dossier",
    tag_project: "Projet",
    tag_host: "Hôte",
    tag_lines: "Lignes",
    tag_files: "Fichiers",
    tag_commit: "Commit",
    tag_stash: "Stash",
    tag_worktree: "Worktree",
    tag_plan: "Offre",
    tag_agent: "Agent",
    tag_artifacts: "Artefacts",
    tag_session: "Session",
    tag_ram: "RAM",
    tag_cache_read: "Cache lu",
    tag_cache_create: "Cache écrit",
    tag_cache_hit: "Cache hit",
    tag_tokens: "Tokens",
    tag_clock: "Heure",
    tag_today: "Aujourd'hui",

    rem: "rest.",
    over_200k: ">200k",
    now: "maintenant",
    unit_d: "j",
    unit_h: "h",
    unit_hr: "h",
    unit_m: "m",
    subagent: "sous-agent",
    subagents: "sous-agents",
    task: "tâche",
    tasks: "tâches",
    tokens_in: "entrée",
    tokens_out: "sortie",
    sandbox_net: "sandbox (réseau)",
    sandbox_isolated: "sandbox (isolée)",
    cmd_preview: "[cmd]",
    cmd_blocked: "[bloqué]",
  },
  es: {
    tag_model: "Modelo",
    tag_quota: "Cuota",
    tag_5h: "5h",
    tag_7d: "7d",
    tag_reset: "Reinicio",
    tag_3p_5h: "Terceros 5h",
    tag_3p_7d: "Terceros 7d",
    tag_argon_7d: "Argon 7d",
    tag_argon_reset: "Reinicio Argon",
    tag_context: "Contexto",
    tag_dir: "Carpeta",
    tag_project: "Proyecto",
    tag_host: "Host",
    tag_lines: "Líneas",
    tag_files: "Archivos",
    tag_commit: "Commit",
    tag_stash: "Stash",
    tag_worktree: "Worktree",
    tag_plan: "Plan",
    tag_agent: "Agente",
    tag_artifacts: "Artefactos",
    tag_session: "Sesión",
    tag_ram: "RAM",
    tag_cache_read: "Caché leída",
    tag_cache_create: "Caché escrita",
    tag_cache_hit: "Cache hit",
    tag_tokens: "Tokens",
    tag_clock: "Hora",
    tag_today: "Hoy",

    rem: "rest.",
    over_200k: ">200k",
    now: "ahora",
    unit_d: "d",
    unit_h: "h",
    unit_hr: "h",
    unit_m: "m",
    subagent: "subagente",
    subagents: "subagentes",
    task: "tarea",
    tasks: "tareas",
    tokens_in: "entrada",
    tokens_out: "salida",
    sandbox_net: "sandbox (red)",
    sandbox_isolated: "sandbox (aislado)",
    cmd_preview: "[cmd]",
    cmd_blocked: "[bloqueado]",
  },
};

const DEFAULT_LANGUAGE = "en";
const SUPPORTED_LANGUAGES = Object.keys(MESSAGES);

// The supported code a setting asks for: the code itself (any case), then its
// base language (fr-FR -> fr), or null.
function matchLanguage(code) {
  if (typeof code !== "string") {
    return null;
  }
  const wanted = code.trim().toLowerCase();
  const base = wanted.split("-")[0];
  return (
    SUPPORTED_LANGUAGES.find((id) => id.toLowerCase() === wanted) ??
    SUPPORTED_LANGUAGES.find((id) => id.toLowerCase() === base) ??
    null
  );
}

function resolveLanguage(code) {
  return matchLanguage(code) ?? DEFAULT_LANGUAGE;
}

function t(key, lang = DEFAULT_LANGUAGE) {
  return MESSAGES[lang]?.[key] ?? MESSAGES[DEFAULT_LANGUAGE][key] ?? key;
}

module.exports = {
  MESSAGES,
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  matchLanguage,
  resolveLanguage,
  t,
};
};
__files["layouts/lines.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const {
  rgb,
  fg,
  mix,
  RESET,
  DIM,
  BOLD,
  NORMAL,
  BLINK,
  gradientColors,
  withContrast,
} = require("../colors");
const { gradientStops, terminalBackground } = require("../themes");
const {
  basenameOf,
  homePath,
  formatResetText,
  formatClockTime,
  paceIndex,
  paceGlyph,
  formatGitSync,
  formatGitOperation,
  gitChangeParts,
  gitFileParts,
  formatTasks,
  formatMode,
  limitWidth,
  shortenPath,
  formatTokens,
  formatContextTokens,
  shortModelName,
  formatTokenSplit,
  formatUsage,
  formatSessionTime,
  resolveQuotaThresholds,
  resolveContextThresholds,
  shouldBlink,
} = require("../formatters");
const { joinFlex } = require("./pills");
const { execWidgetOutput, restoreAfterReset } = require("../exec");
const {
  NAMED_COLORS,
  resolveColor,
  widgetColors,
  widgetTag,
  OS_ICONS,
  isRaw,
  isPaced,
  METER_STYLES,
  meterStyle,
  hiddenByThreshold,
  hasNoData,
  RAM_CAUTION,
  RAM_DANGER,
  TITLE_MAX,
} = require("../widget-style");
const { t } = require("../i18n");

const LINES = NAMED_COLORS;

function deriveLinesPalette(colors) {
  if (!colors) {
    return LINES;
  }
  return {
    model: colors.model || LINES.blue,
    location: colors.meta || LINES.cyan,
    git: colors.git || LINES.green,
    gitDirty: colors.gitDirty || LINES.red,
    agent: colors.model || LINES.magenta,
    text: colors.meta || LINES.white,
    quotaLow: colors.fiveHour || LINES.green,
    // Quota/context states: ok -> caution -> danger. The medium band stays
    // "ok" so each state has one unmistakable color (also for color-blind users).
    quotaMed: colors.fiveHour || LINES.green,
    quotaHigh: colors.caution || LINES.yellow,
    quotaCrit: colors.warn || LINES.red,
    track: colors.track || rgb(60, 65, 75),
  };
}

function colorForUsedPct(pct, palette = LINES, options = {}) {
  const crit = options.crit ?? 90;
  const warn = options.warn ?? 70;
  const med = options.med ?? 50;

  const critCol = palette.quotaCrit || palette.red || LINES.red;
  const highCol = palette.quotaHigh || palette.yellow || LINES.yellow;
  const medCol = palette.quotaMed || palette.orange || LINES.orange;
  const lowCol = palette.quotaLow || palette.green || LINES.green;

  if (pct >= crit) {
    return critCol;
  }

  if (pct >= warn) {
    return highCol;
  }

  if (pct >= med) {
    return medCol;
  }

  return lowCol;
}

function colorForRemainingPct(pct, palette = LINES, options = {}) {
  const crit = options.crit ?? 10;
  const warn = options.warn ?? 30;
  const med = options.med ?? 50;

  const critCol = palette.quotaCrit || palette.red || LINES.red;
  const highCol = palette.quotaHigh || palette.yellow || LINES.yellow;
  const medCol = palette.quotaMed || palette.orange || LINES.orange;
  const lowCol = palette.quotaLow || palette.green || LINES.green;

  if (pct <= crit) {
    return critCol;
  }

  if (pct <= warn) {
    return highCol;
  }

  if (pct <= med) {
    return medCol;
  }

  return lowCol;
}

function renderDotMeter(
  pctVal,
  width = 25,
  ascii = false,
  palette = LINES,
  isRemaining = false,
  options = {}
) {
  const pct = Math.max(0, Math.min(100, Number(pctVal)));
  const fillPct = isRemaining ? Math.max(0, Math.min(100, 100 - pct)) : pct;
  const filled = Math.min(width, Math.round((fillPct * width) / 100));
  const empty = width - filled;
  const color =
    options.color ??
    (isRemaining
      ? colorForRemainingPct(pct, palette, options)
      : colorForUsedPct(pct, palette, options));

  const marker = paceIndex(options.elapsedPct, width);
  const [full, blank, pace] = METER_STYLES[options.style] || METER_STYLES.dots;
  // A Classic meter is one color: the empty glyph's own texture (░) sets it
  // apart, and the pace marker is a thin line.
  const classic = options.classic === true;
  const track = palette.track || rgb(60, 65, 75);
  // ramp shades each filled cell by its place, from the theme's ok color to
  // caution to danger, over the track; rings keeps the fill's color, faded.
  const ramp = options.style === "ramp";
  const trackColor = ramp
    ? track
    : options.style === "rings"
      ? mix(color, track, 0.5)
      : classic
        ? color
        : track;
  const fillColor = (i) => (ramp ? rampColor(width > 1 ? i / (width - 1) : 0, palette) : color);
  const markerColor = palette.text || LINES.white;

  if (marker < 0 && !ramp) {
    if (ascii) {
      return fg(color) + "#".repeat(filled) + DIM + "-".repeat(empty) + RESET;
    }
    return fg(color) + full.repeat(filled) + fg(trackColor) + blank.repeat(empty) + RESET;
  }

  // The marker replaces the dot where the quota window currently is.
  const markGlyph = ascii ? paceGlyph(true) : classic ? "│" : pace || paceGlyph(false);
  // ASCII empties are dim; NORMAL ends that without dropping a blink.
  const undim = ascii ? NORMAL : "";
  let out = "";
  for (let i = 0; i < width; i++) {
    if (i === marker) {
      out += undim + fg(markerColor) + markGlyph;
    } else if (i < filled) {
      out += undim + fg(fillColor(i)) + (ascii ? "#" : full);
    } else {
      out += ascii ? DIM + "-" : fg(trackColor) + blank;
    }
  }
  return out + RESET;
}

// A point along the meter, 0 to 1, as a color between ok, caution and danger.
function rampColor(at, palette) {
  const ok = palette.quotaLow || LINES.green;
  const caution = palette.quotaHigh || LINES.yellow;
  const danger = palette.quotaCrit || LINES.red;
  return at <= 0.5 ? mix(ok, caution, at * 2) : mix(caution, danger, (at - 0.5) * 2);
}

function buildLinesSegment(id, session, palette, emojis, ascii = false, widget = {}, config = {}) {
  // Raw widgets keep only their value: no icon, no label.
  const raw = isRaw(widget, config);
  const tag = (icon) => widgetTag(id, { emojis, raw, icon, widget, ascii, lang: session.lang });
  // Meters: 25 cells, or 12 when the bar is fitted to a narrow terminal;
  // Classic draws the same cells as blocks.
  const classic = config.layout === "classic";
  const dots = widget?.compact ? 12 : 25;
  const style = meterStyle(widget, config, classic ? "classic" : "lines");
  const pace = (quota, thresh) => ({
    ...thresh,
    style,
    classic,
    elapsedPct: isPaced(widget, config) ? quota.elapsedPct : null,
  });
  const over200k = session.exceeds200k ? ` ${t("over_200k", session.lang)}` : "";
  const remWord = t("rem", session.lang);

  function quotaState(quota) {
    const thresh = resolveQuotaThresholds(widget, config);
    const rem = quota.remaining;
    const level = rem <= thresh.crit ? "crit" : rem <= thresh.warn ? "warn" : "normal";
    const blinkSeq = !ascii && shouldBlink(level, thresh.blink) ? BLINK : "";
    const color = colorForRemainingPct(Math.round(rem), palette, thresh);
    return { thresh, rem, blinkSeq, color };
  }

  // A quota meter with its remaining %, for the 5h, 7d and third-party bars.
  function quotaMeter(quota) {
    const { thresh, rem, blinkSeq, color } = quotaState(quota);
    return (
      blinkSeq +
      fg(palette.text) +
      tag() +
      renderDotMeter(rem, dots, ascii, palette, true, pace(quota, thresh)) +
      " " +
      fg(color) +
      `${rem.toFixed(1)}% ${remWord}` +
      RESET
    );
  }

  function quotaPct(quota) {
    const { rem, blinkSeq, color } = quotaState(quota);
    return (
      blinkSeq + fg(palette.text) + tag() + fg(color) + `${rem.toFixed(1)}% ${remWord}` + RESET
    );
  }

  function quotaReset(quota, weekly) {
    const text = quota
      ? formatResetText(quota, {
          format: widget.format,
          fallback: "countdown",
          weekly,
          clock: config.clock,
        })
      : "";
    // No usable reset in the payload: hide rather than claim "now".
    return text ? fg(palette.text) + tag() + text + RESET : null;
  }

  // Context widgets share their state color and blink.
  function contextState() {
    const thresh = resolveContextThresholds(widget, config);
    const isCrit = session.exceeds200k || session.contextPct >= thresh.crit;
    const isWarn = session.contextPct >= thresh.warn;
    const level = isCrit ? "crit" : isWarn ? "warn" : "normal";
    const blinkSeq = !ascii && shouldBlink(level, thresh.blink) ? BLINK : "";
    const color = session.exceeds200k
      ? palette.quotaCrit || palette.red || LINES.red
      : colorForUsedPct(Math.round(session.contextPct), palette, thresh);
    return { thresh, blinkSeq, color };
  }

  if (hasNoData(id, session) || hiddenByThreshold(id, widget, session)) {
    return null;
  }

  switch (id) {
    case "clock":
      return fg(palette.text) + tag() + formatClockTime(new Date(), config.clock) + RESET;

    case "model":
      if (!session.model) {
        return null;
      }
      return (
        fg(palette.model) +
        tag() +
        limitWidth(
          widget?.short ? shortModelName(session.model, ascii) : session.model,
          widget,
          ascii
        ) +
        RESET
      );

    case "quota": {
      const quota = session.tightestQuota;
      if (!quota) {
        return null;
      }
      const { rem, blinkSeq, color } = quotaState(quota);
      const reset = quota.reset ? `${ascii ? ", " : " · "}${quota.reset}` : "";
      return (
        blinkSeq +
        fg(palette.text) +
        tag() +
        `${quota.label} ` +
        fg(color) +
        `${rem.toFixed(1)}% ${remWord}` +
        fg(palette.text) +
        reset +
        RESET
      );
    }

    case "agentState": {
      if (!session.agentState) {
        return null;
      }
      const idle = session.agentState === "idle";
      const color = idle ? DIM : fg(palette.agent || palette.magenta || LINES.magenta);
      return color + tag(idle ? "🟢" : undefined) + session.agentState.replace(/_/g, " ") + RESET;
    }

    case "fiveHourBar":
      return session.fiveHour ? quotaMeter(session.fiveHour) : null;

    case "fiveHourPct":
      return session.fiveHour ? quotaPct(session.fiveHour) : null;

    case "fiveHourReset":
      return quotaReset(session.fiveHour, false);

    case "weeklyBar":
      return session.weekly ? quotaMeter(session.weekly) : null;

    case "weeklyPct":
      return session.weekly ? quotaPct(session.weekly) : null;

    case "weeklyReset":
      return quotaReset(session.weekly, true);

    case "thirdPartyFiveHour":
      if (!session.thirdPartyFiveHour || session.thirdPartyFiveHour.disabled) {
        return null;
      }
      return quotaPct(session.thirdPartyFiveHour);

    case "thirdPartyWeekly":
      return session.thirdPartyWeekly ? quotaPct(session.thirdPartyWeekly) : null;

    case "argonWeekly":
      return session.argonWeekly ? quotaMeter(session.argonWeekly) : null;

    case "argonReset":
      return quotaReset(session.argonWeekly, true);

    case "context": {
      const { thresh, blinkSeq, color } = contextState();
      return (
        blinkSeq +
        fg(palette.text) +
        tag() +
        renderDotMeter(session.contextPct, dots, ascii, palette, false, {
          ...thresh,
          color,
          style,
          classic,
        }) +
        " " +
        fg(color) +
        `${formatContextTokens(session.usedTokens, session.contextSize)} ` +
        `(${session.contextPct.toFixed(1)}%)${over200k}` +
        RESET
      );
    }

    case "contextPct": {
      const { blinkSeq, color } = contextState();
      return (
        blinkSeq +
        fg(palette.text) +
        tag() +
        fg(color) +
        `${session.contextPct.toFixed(1)}%${over200k}` +
        RESET
      );
    }

    case "contextTokens": {
      const { blinkSeq, color } = contextState();
      return (
        blinkSeq +
        fg(palette.text) +
        tag() +
        fg(color) +
        formatContextTokens(session.usedTokens, session.contextSize) +
        RESET
      );
    }

    case "cwd": {
      const dirname = limitWidth(
        shortenPath(homePath(session.cwd), widget?.depth, ascii),
        widget,
        ascii,
        session.lang
      );
      if (!dirname) {
        return null;
      }
      return fg(palette.location) + tag() + dirname + RESET;
    }

    case "project": {
      const proj = limitWidth(basenameOf(session.project), widget, ascii);
      if (!proj) {
        return null;
      }
      return fg(palette.location) + tag() + proj + RESET;
    }

    case "os": {
      if (!session.os) {
        return null;
      }
      return fg(palette.location) + tag(OS_ICONS[session.os]) + session.os + RESET;
    }

    case "host": {
      if (!session.hostname) {
        return null;
      }
      const name = session.username ? `${session.username}@${session.hostname}` : session.hostname;
      return fg(palette.location) + tag() + name + RESET;
    }

    case "git": {
      if (!session.git || !session.git.branch) {
        return null;
      }
      const opStr = widget.operation === false ? "" : formatGitOperation(session.git.operation);
      const syncStr = formatGitSync(session.git.ahead, session.git.behind, ascii);
      const syncPart = syncStr ? ` ${syncStr}` : "";
      const branch = limitWidth(session.git.branch, widget, ascii);
      return (
        fg(palette.git) +
        tag() +
        "(" +
        branch +
        (session.git.dirty ? `${fg(palette.gitDirty)}*` : "") +
        (opStr ? `${fg(palette.gitDirty)} ${opStr}` : "") +
        (syncPart ? `${fg(palette.git)}${syncPart}` : "") +
        fg(palette.git) +
        ")" +
        RESET
      );
    }

    case "gitChanges": {
      const parts = gitChangeParts(session.gitDetails?.changes, ascii);
      if (!parts.length) {
        return null;
      }
      const shade = { added: palette.quotaLow, removed: palette.quotaCrit };
      return (
        fg(palette.git) +
        tag() +
        parts.map((part) => fg(shade[part.kind]) + part.text).join(" ") +
        RESET
      );
    }

    case "gitFiles": {
      const parts = gitFileParts(session.gitDetails?.files, ascii);
      if (!parts.length) {
        return null;
      }
      const shade = (kind) => (kind === "conflicts" ? palette.quotaCrit : palette.git);
      return (
        fg(palette.git) +
        tag() +
        parts.map((part) => fg(shade(part.kind)) + part.text).join(" ") +
        RESET
      );
    }

    case "gitSha":
      if (!session.gitDetails?.sha) {
        return null;
      }
      return fg(palette.git) + tag() + session.gitDetails.sha + RESET;

    case "gitStash":
      if (!(session.gitDetails?.stash > 0)) {
        return null;
      }
      return fg(palette.git) + tag() + session.gitDetails.stash + RESET;

    case "gitWorktree":
      if (!session.gitDetails?.worktree) {
        return null;
      }
      return (
        fg(palette.git) + tag() + limitWidth(session.gitDetails.worktree, widget, ascii) + RESET
      );

    case "plan":
      if (!session.plan) {
        return null;
      }
      return fg(palette.text) + tag() + session.plan + RESET;

    case "artifacts":
      if (!session.artifacts) {
        return null;
      }
      return fg(palette.text) + tag() + String(session.artifacts) + RESET;

    case "tasks": {
      const text = formatTasks(session.subagents, session.tasks, session.lang);
      if (!text) {
        return null;
      }
      return fg(palette.text) + tag() + text + RESET;
    }

    case "mode": {
      const text = formatMode(session.approvalMode, session.vimMode);
      if (!text) {
        return null;
      }
      // An approval mode like accept-edits changes what the agent may do alone.
      const approval = session.approvalMode && session.approvalMode !== "default";
      const color = approval ? palette.quotaHigh || palette.yellow || LINES.yellow : palette.text;
      return fg(color) + tag() + text + RESET;
    }

    case "title":
      if (!session.title) {
        return null;
      }
      return fg(palette.text) + tag() + limitWidth(session.title, widget, ascii, TITLE_MAX) + RESET;

    case "sessionTime": {
      const text = formatSessionTime(session.sessionStartMs, Date.now(), session.lang);
      return text ? fg(palette.text) + tag() + text + RESET : null;
    }

    case "sandbox": {
      if (!session.sandbox) {
        return null;
      }
      const net = session.sandboxNet;
      const color = net ? palette.quotaMed || palette.orange || LINES.orange : palette.git;
      const text = t(net ? "sandbox_net" : "sandbox_isolated", session.lang);
      return fg(color) + tag(net ? "🌐" : undefined) + text + RESET;
    }

    case "ram": {
      if (session.ramPct == null) {
        return null;
      }
      const ramCol =
        session.ramPct >= RAM_DANGER
          ? palette.quotaCrit
          : session.ramPct >= RAM_CAUTION
            ? palette.quotaHigh
            : palette.text;
      return fg(palette.text) + tag() + fg(ramCol) + `${session.ramPct}%` + RESET;
    }

    case "version":
      if (!session.version) {
        return null;
      }
      return fg(palette.text) + tag() + `v${session.version}` + RESET;

    case "cacheRead":
      if (session.cacheRead == null) {
        return null;
      }
      return fg(palette.text) + tag() + formatTokens(session.cacheRead) + RESET;

    case "cacheCreate":
      if (session.cacheCreate == null) {
        return null;
      }
      return fg(palette.text) + tag() + formatTokens(session.cacheCreate) + RESET;

    case "cacheHit": {
      const pct = session.cacheHitPct ?? 0;
      const color =
        pct >= 80
          ? palette.quotaLow || palette.green || LINES.green
          : pct >= 50
            ? palette.quotaMed || palette.orange || LINES.orange
            : palette.text;
      return fg(palette.text) + tag() + fg(color) + `${pct}%` + RESET;
    }

    case "totalTokens":
      if (!session.totalTokens) {
        return null;
      }
      return (
        fg(palette.text) +
        tag() +
        (widget?.split
          ? formatTokenSplit(session.inputTokens, session.outputTokens, ascii, session.lang)
          : formatTokens(session.totalTokens)) +
        RESET
      );

    case "tokensToday":
    case "tokensWeek": {
      const usage = formatUsage(
        session.usage?.[id === "tokensToday" ? "today" : "week"],
        widget,
        ascii,
        session.lang
      );
      if (!usage) {
        return null;
      }
      // A budget alerts like the context widgets: caution, then danger.
      const thresh = resolveContextThresholds(widget, config);
      const level =
        usage.pct === null
          ? "normal"
          : usage.pct >= thresh.crit
            ? "crit"
            : usage.pct >= thresh.warn
              ? "warn"
              : "normal";
      const color =
        level === "crit" ? palette.quotaCrit : level === "warn" ? palette.quotaHigh : palette.text;
      const blinkSeq = !ascii && shouldBlink(level, thresh.blink) ? BLINK : "";
      return blinkSeq + fg(palette.text) + tag() + fg(color) + usage.text + RESET;
    }

    case "customText": {
      if (!widget?.text) {
        return null;
      }
      return fg(palette.text) + tag() + limitWidth(widget.text, widget, ascii) + RESET;
    }

    case "exec": {
      // Only real output is cut: the [cmd] preview and blocked markers stay whole.
      const output =
        session.execMode === "run"
          ? limitWidth(execWidgetOutput(widget, session), widget, ascii)
          : execWidgetOutput(widget, session);
      if (!output) {
        return null;
      }
      const icon = widget.icon !== undefined ? widget.icon : "⚡";
      const named = widget.label && !raw ? `${widget.label}: ` : "";
      // buildLinesRows already swapped the widget's color into the palette.
      const col = palette.location;
      const iconPart = emojis && icon && !raw ? `${icon} ` : "";
      return fg(col) + iconPart + named + restoreAfterReset(output, fg(col)) + RESET;
    }

    default:
      return null;
  }
}

// A widget's own color and text color become a palette for that widget only.
function widgetPalette(widget, palette, colors) {
  if (!colors || (!widget.color && !widget.textColor)) {
    return palette;
  }
  const own = deriveLinesPalette(widgetColors(widget, colors));
  const text = resolveColor(widget.textColor, colors);
  return text ? { ...own, text } : own;
}

function buildLinesRows(session, config, palette, emojis, ascii = false, colors = null) {
  const widgetList = Array.isArray(config?.widgets) ? config.widgets : [];
  if (!widgetList.length) {
    return [];
  }

  // Split widgets by lineBreak into row definition lists
  const rowDefs = [];
  let currentRowDef = [];

  for (const widget of widgetList) {
    if (widget.id === "lineBreak") {
      rowDefs.push(currentRowDef);
      currentRowDef = [];
    } else {
      currentRowDef.push(widget);
    }
  }
  rowDefs.push(currentRowDef);

  const rows = [];
  const gradient = colors ? gradientStops(config?.gradient) : null;
  const background = terminalBackground(colors);

  function renderItem(widget, widgetPal) {
    const item = buildLinesSegment(widget.id, session, widgetPal, emojis, ascii, widget, config);
    // Bold has to survive the resets inside the segment.
    return item && widget.bold === true
      ? BOLD + item.split(RESET).join(RESET + BOLD) + RESET
      : item;
  }

  for (const def of rowDefs) {
    const groups = [];
    let currentGroup = [];
    // The widgets shown in this row, so a gradient spreads over exactly those.
    const placed = [];

    function flushGroup() {
      if (currentGroup.length) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    }

    for (const widget of def) {
      if (!widget) {
        continue;
      }

      if (widget.id === "separator") {
        flushGroup();
        continue;
      }

      const item = renderItem(widget, widgetPalette(widget, palette, colors));

      if (item) {
        placed.push({ widget, group: currentGroup, index: currentGroup.length });
        currentGroup.push(item);
      }
    }

    flushGroup();

    // Each widget's text takes its step of the gradient, made readable on the
    // terminal background; alert colors and a widget's own color stay.
    if (gradient && placed.length) {
      const shades = gradientColors(gradient, placed.length);
      placed.forEach(({ widget, group, index }, i) => {
        if (resolveColor(widget.color, colors)) {
          return;
        }
        const shade = withContrast(shades[i], background);
        const item = renderItem(
          widget,
          widgetPalette({ ...widget, color: shade }, palette, colors)
        );
        if (item) {
          group[index] = item;
        }
      });
    }

    if (groups.length) {
      rows.push(groups);
    }
  }

  return rows;
}

function renderLinesLayout(session, emojis, ascii = false, colors, config) {
  const palette = deriveLinesPalette(colors);
  const rows = buildLinesRows(session, config, palette, emojis, ascii, colors);

  if (!rows.length) {
    return RESET;
  }

  const pipe = ` ${DIM}${ascii || config.layout === "classic" ? "|" : "│"}${RESET} `;

  return (
    rows
      .map((groups) => {
        const parts = groups.map((group) => group.join(pipe));
        return joinFlex(parts, session.terminalWidth, session.flexGaps === true);
      })
      // rowGap: a line holding a space, as in Pills, so a host keeps it.
      .join(config.rowGap === true ? "\n \n" : "\n") + RESET
  );
}

module.exports = {
  LINES,
  deriveLinesPalette,
  colorForUsedPct,
  colorForRemainingPct,
  renderDotMeter,
  buildLinesSegment,
  buildLinesRows,
  renderLinesLayout,
};
};
__files["layouts/pills.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const {
  shade,
  mix,
  bg,
  bgDefault,
  fg,
  BOLD,
  DIM,
  NORMAL,
  BLINK,
  BLINK_OFF,
  getActiveDepth,
  gradientColors,
  readableText,
  withContrast,
} = require("../colors");
const { gradientStops } = require("../themes");
const { pickGlyph, glyphChar } = require("../powerline");
const {
  quotaColor,
  contextColor,
  formatClockTime,
  resolveQuotaThresholds,
  resolveContextThresholds,
  shouldBlink,
  formatTokens,
  formatContextTokens,
  shortModelName,
  formatTokenSplit,
  formatUsage,
  formatSessionTime,
  formatGitSync,
  formatGitOperation,
  gitChangeParts,
  gitFileParts,
  formatTasks,
  formatMode,
  limitWidth,
  shortenPath,
  homePath,
  basenameOf,
  label,
  visibleWidth,
  formatResetText,
  paceIndex,
  paceGlyph,
} = require("../formatters");
const { execWidgetOutput, restoreAfterReset } = require("../exec");
const {
  resolveColor,
  widgetColors,
  widgetTag,
  OS_ICONS,
  isRaw,
  isPaced,
  METER_STYLES,
  meterStyle,
  hiddenByThreshold,
  hasNoData,
  RAM_CAUTION,
  RAM_DANGER,
  TITLE_MAX,
} = require("../widget-style");
const { t } = require("../i18n");

const WHITE = [255, 255, 255];

// The pace marker sits in the cell matching how much of the quota window has
// passed: a fill reaching past it means quota is going faster than time. It
// takes the other cell color (track on fill, fill on track) so it always shows.
function fillMeter(pct, width, fillColor, emptyColor, segmentColor, pace = {}) {
  const ratio = Math.max(0, Math.min(100, Number(pct))) / 100;
  const used = Math.round(ratio * width);
  const marker = paceIndex(pace.elapsedPct, width);
  // pips, the default, needs a Unicode font: ASCII mode keeps the cells.
  const pips = pace.style === "pips";
  if (pips && !pace.ascii && getActiveDepth() !== "none") {
    const track = withContrast(segmentColor, segmentColor, PIP_CONTRAST, pace.textColor);
    return pipMeter(used, marker, width, pace.textColor, track) + bg(segmentColor);
  }
  if (METER_STYLES[pace.style] && !(pips && pace.ascii)) {
    return glyphMeter(used, marker, width, METER_STYLES[pace.style], pace);
  }
  // The fill is a background color; without color it is drawn with glyphs.
  const plain = getActiveDepth() === "none";
  const glyph = (filled) => (!plain ? " " : pace.ascii ? (filled ? "#" : "-") : filled ? "█" : "░");
  let meter = "";

  for (let i = 0; i < width; i++) {
    const filled = i < used;
    const cell = bg(filled ? fillColor : emptyColor);
    meter +=
      i === marker
        ? cell + fg(filled ? emptyColor : fillColor) + paceGlyph(pace.ascii)
        : cell + glyph(filled);
  }

  return meter + bg(segmentColor);
}

// Small dots on the pill's own color: the filled ones in the pill's text color,
// the rest in the pill's color moved toward it until they reach 3:1 (WCAG's
// minimum for graphics). A light fill and a dark track can't both stand out
// on every pill: on a bright one the light dots fade, on a deep one the dark
// ones do. The pace marker is a larger dot in the other color, so nothing in
// the meter is a line.
const PIP_CONTRAST = 3;

function pipMeter(used, marker, width, fillColor, emptyColor) {
  let meter = "";
  let color = null;

  for (let i = 0; i < width; i++) {
    const filled = i < used;
    const next = i === marker ? (filled ? emptyColor : fillColor) : filled ? fillColor : emptyColor;
    if (next !== color) {
      meter += fg(next);
      color = next;
    }
    meter += i === marker ? METER_STYLES.pips[2] : METER_STYLES.pips[0];
  }

  return meter;
}

// A glyph style draws on the pill's own color, with no cells: filled glyphs in
// the pill's text color (readable on the pill, gradients included), empty
// ones in the same color dimmed. ASCII mode keeps # and -.
function glyphMeter(used, marker, width, [full, empty, pace], { ascii, textColor }) {
  let meter = fg(textColor);
  let dim = false;

  for (let i = 0; i < width; i++) {
    const blank = i !== marker && i >= used;
    if (blank !== dim) {
      meter += blank ? DIM : NORMAL;
      dim = blank;
    }
    if (i === marker) {
      meter += (!ascii && pace) || paceGlyph(ascii);
    } else if (ascii) {
      meter += blank ? "-" : "#";
    } else {
      meter += blank ? empty : full;
    }
  }

  return dim ? meter + NORMAL : meter;
}

function meterSegment(
  color,
  pct,
  prefix,
  suffix,
  isRemaining = false,
  blink = false,
  elapsedPct = null
) {
  // A light fill on a dark track reads at a glance on any pill color, deep
  // (light themes) or bright (dark themes).
  return {
    color,
    meter: true,
    pct,
    fill: mix(color, WHITE, 0.6),
    empty: shade(color, 0.5),
    prefix,
    suffix,
    isRemaining: Boolean(isRemaining),
    blink: Boolean(blink),
    elapsedPct,
  };
}

function pill(color, text, blink = false) {
  return { color, text, blink: Boolean(blink) };
}

function buildSegment(id, session, colors, emojis, ascii = false, widget = {}, config = {}) {
  // Raw widgets keep only their value: no icon, no label.
  const raw = isRaw(widget, config);
  const tag = (icon) => widgetTag(id, { emojis, raw, icon, widget, ascii, lang: session.lang });
  const lbl = (value, icon) => ` ${tag(icon)}${value} `;
  // The pill frames a colored meter; plain-text meters (ASCII) get brackets.
  const open = ascii ? "[" : "";
  const close = ascii ? "]" : "";
  const meterLabel = () => ` ${tag()}${open}`;
  const pace = (quota) => (isPaced(widget, config) ? quota.elapsedPct : null);
  const over200k = session.exceeds200k ? ` ${t("over_200k", session.lang)}` : "";
  const remWord = t("rem", session.lang);

  if (hasNoData(id, session) || hiddenByThreshold(id, widget, session)) {
    return null;
  }

  switch (id) {
    case "clock":
      return pill(colors.meta, lbl(formatClockTime(new Date(), config.clock)));

    case "model":
      if (!session.model) {
        return null;
      }
      return pill(
        colors.model,
        lbl(
          limitWidth(
            widget?.short ? shortModelName(session.model, ascii) : session.model,
            widget,
            ascii
          )
        )
      );

    case "quota": {
      const quota = session.tightestQuota;
      if (!quota) {
        return null;
      }
      const thresh = resolveQuotaThresholds(widget, config);
      const rem = quota.remaining;
      const level = rem <= thresh.crit ? "crit" : rem <= thresh.warn ? "warn" : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = quotaColor(rem, colors.fiveHour, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      const reset = quota.reset ? `${ascii ? ", " : " · "}${quota.reset}` : "";
      return pill(color, lbl(`${quota.label} ${rem.toFixed(1)}% ${remWord}${reset}`), blink);
    }

    case "fiveHourBar": {
      if (!session.fiveHour) {
        return null;
      }
      const thresh = resolveQuotaThresholds(widget, config);
      const rem = session.fiveHour.remaining;
      const level = rem <= thresh.crit ? "crit" : rem <= thresh.warn ? "warn" : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = quotaColor(rem, colors.fiveHour, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return meterSegment(
        color,
        rem,
        meterLabel(),
        `${close} ${rem.toFixed(1)}% ${remWord} `,
        true,
        blink,
        pace(session.fiveHour)
      );
    }

    case "fiveHourPct": {
      if (!session.fiveHour) {
        return null;
      }
      const thresh = resolveQuotaThresholds(widget, config);
      const rem = session.fiveHour.remaining;
      const level = rem <= thresh.crit ? "crit" : rem <= thresh.warn ? "warn" : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = quotaColor(rem, colors.fiveHour, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return pill(color, lbl(`${rem.toFixed(1)}% ${remWord}`), blink);
    }

    case "fiveHourReset": {
      const text = session.fiveHour
        ? formatResetText(session.fiveHour, {
            format: widget.format,
            fallback: "countdown",
            clock: config.clock,
          })
        : "";
      // No usable reset in the payload: hide rather than claim "now".
      if (!text) {
        return null;
      }
      return pill(colors.fiveHour, lbl(text));
    }

    case "weeklyBar": {
      if (!session.weekly) {
        return null;
      }
      const thresh = resolveQuotaThresholds(widget, config);
      const rem = session.weekly.remaining;
      const level = rem <= thresh.crit ? "crit" : rem <= thresh.warn ? "warn" : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = quotaColor(rem, colors.weekly, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return meterSegment(
        color,
        rem,
        meterLabel(),
        `${close} ${rem.toFixed(1)}% ${remWord} `,
        true,
        blink,
        pace(session.weekly)
      );
    }

    case "weeklyPct": {
      if (!session.weekly) {
        return null;
      }
      const thresh = resolveQuotaThresholds(widget, config);
      const rem = session.weekly.remaining;
      const level = rem <= thresh.crit ? "crit" : rem <= thresh.warn ? "warn" : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = quotaColor(rem, colors.weekly, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return pill(color, lbl(`${rem.toFixed(1)}% ${remWord}`), blink);
    }

    case "weeklyReset": {
      const text = session.weekly
        ? formatResetText(session.weekly, {
            format: widget.format,
            fallback: "countdown",
            weekly: true,
            clock: config.clock,
          })
        : "";
      // No usable reset in the payload: hide rather than claim "now".
      if (!text) {
        return null;
      }
      return pill(colors.weekly, lbl(text));
    }

    case "thirdPartyFiveHour": {
      if (!session.thirdPartyFiveHour || session.thirdPartyFiveHour.disabled) {
        return null;
      }
      const thresh = resolveQuotaThresholds(widget, config);
      const rem = session.thirdPartyFiveHour.remaining;
      const level = rem <= thresh.crit ? "crit" : rem <= thresh.warn ? "warn" : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = quotaColor(rem, colors.thirdParty, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return meterSegment(
        color,
        rem,
        meterLabel(),
        `${close} ${rem.toFixed(1)}% ${remWord} `,
        true,
        blink,
        pace(session.thirdPartyFiveHour)
      );
    }

    case "thirdPartyWeekly": {
      if (!session.thirdPartyWeekly) {
        return null;
      }
      const thresh = resolveQuotaThresholds(widget, config);
      const rem = session.thirdPartyWeekly.remaining;
      const level = rem <= thresh.crit ? "crit" : rem <= thresh.warn ? "warn" : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = quotaColor(rem, colors.thirdParty, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return meterSegment(
        color,
        rem,
        meterLabel(),
        `${close} ${rem.toFixed(1)}% ${remWord} `,
        true,
        blink,
        pace(session.thirdPartyWeekly)
      );
    }

    // Argon is a Gemini model, so its quota takes the Gemini 7d color; the
    // 🔮 tag tells the two apart.
    case "argonWeekly": {
      if (!session.argonWeekly) {
        return null;
      }
      const thresh = resolveQuotaThresholds(widget, config);
      const rem = session.argonWeekly.remaining;
      const level = rem <= thresh.crit ? "crit" : rem <= thresh.warn ? "warn" : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = quotaColor(rem, colors.weekly, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return meterSegment(
        color,
        rem,
        meterLabel(),
        `${close} ${rem.toFixed(1)}% ${remWord} `,
        true,
        blink,
        pace(session.argonWeekly)
      );
    }

    case "argonReset": {
      const text = session.argonWeekly
        ? formatResetText(session.argonWeekly, {
            format: widget.format,
            fallback: "countdown",
            weekly: true,
            clock: config.clock,
          })
        : "";
      if (!text) {
        return null;
      }
      return pill(colors.weekly, lbl(text));
    }

    case "context": {
      const thresh = resolveContextThresholds(widget, config);
      const level =
        session.exceeds200k || session.contextPct >= thresh.crit
          ? "crit"
          : session.contextPct >= thresh.warn
            ? "warn"
            : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = contextColor(session.contextPct, colors.context, session.exceeds200k, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return meterSegment(
        color,
        session.contextPct,
        meterLabel(),
        `${close} ${formatContextTokens(session.usedTokens, session.contextSize)} (${session.contextPct.toFixed(1)}%)${over200k} `,
        false,
        blink
      );
    }

    case "contextPct": {
      const thresh = resolveContextThresholds(widget, config);
      const level =
        session.exceeds200k || session.contextPct >= thresh.crit
          ? "crit"
          : session.contextPct >= thresh.warn
            ? "warn"
            : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = contextColor(session.contextPct, colors.context, session.exceeds200k, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return pill(color, lbl(`${session.contextPct.toFixed(1)}%${over200k}`), blink);
    }

    case "contextTokens": {
      const thresh = resolveContextThresholds(widget, config);
      const level =
        session.exceeds200k || session.contextPct >= thresh.crit
          ? "crit"
          : session.contextPct >= thresh.warn
            ? "warn"
            : "normal";
      const blink = !ascii && shouldBlink(level, thresh.blink);
      const color = contextColor(session.contextPct, colors.context, session.exceeds200k, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return pill(color, lbl(formatContextTokens(session.usedTokens, session.contextSize)), blink);
    }

    case "cwd": {
      const name = limitWidth(
        shortenPath(homePath(session.cwd), widget?.depth, ascii),
        widget,
        ascii,
        session.lang
      );
      if (!name) {
        return null;
      }
      return pill(colors.meta, lbl(name));
    }

    case "project": {
      const name = limitWidth(basenameOf(session.project), widget, ascii);
      if (!name) {
        return null;
      }
      return pill(colors.meta, lbl(name));
    }

    case "os": {
      if (!session.os) {
        return null;
      }
      return pill(colors.meta, lbl(session.os, OS_ICONS[session.os]));
    }

    case "host": {
      if (!session.hostname) {
        return null;
      }
      const name = session.username ? `${session.username}@${session.hostname}` : session.hostname;
      return pill(colors.meta, lbl(name));
    }

    case "git": {
      // Antigravity can send vcs.type without a branch; an empty pill says nothing.
      if (!session.git?.branch) {
        return null;
      }
      const mark = session.git.dirty ? `${ascii ? "* " : "● "}` : "";
      const opStr = widget.operation === false ? "" : formatGitOperation(session.git.operation);
      const opPart = opStr ? `|${opStr}` : "";
      const syncStr = formatGitSync(session.git.ahead, session.git.behind, ascii);
      const syncPart = syncStr ? ` ${syncStr}` : "";
      const branch = limitWidth(session.git.branch, widget, ascii);
      return pill(
        session.git.dirty ? colors.gitDirty : colors.git,
        lbl(`${mark}${branch}${opPart}${syncPart}`)
      );
    }

    case "gitChanges": {
      const parts = gitChangeParts(session.gitDetails?.changes, ascii);
      if (!parts.length) {
        return null;
      }
      return pill(colors.git, lbl(parts.map((part) => part.text).join(" ")));
    }

    case "gitFiles": {
      const files = session.gitDetails?.files;
      const parts = gitFileParts(files, ascii);
      if (!parts.length) {
        return null;
      }
      const color = files.conflicts > 0 ? colors.gitDirty : colors.git;
      return pill(color, lbl(parts.map((part) => part.text).join(" ")));
    }

    case "gitSha":
      if (!session.gitDetails?.sha) {
        return null;
      }
      return pill(colors.git, lbl(session.gitDetails.sha));

    case "gitStash":
      if (!(session.gitDetails?.stash > 0)) {
        return null;
      }
      return pill(colors.git, lbl(String(session.gitDetails.stash)));

    case "gitWorktree":
      if (!session.gitDetails?.worktree) {
        return null;
      }
      return pill(colors.git, lbl(limitWidth(session.gitDetails.worktree, widget, ascii)));

    case "plan":
      if (!session.plan) {
        return null;
      }
      return pill(colors.meta, lbl(session.plan));

    case "agentState":
      if (!session.agentState) {
        return null;
      }
      return pill(
        session.agentState === "idle" ? colors.meta : colors.warn,
        lbl(session.agentState.replace(/_/g, " "), session.agentState === "idle" ? "🟢" : undefined)
      );

    case "artifacts":
      if (!session.artifacts) {
        return null;
      }
      return pill(colors.meta, lbl(String(session.artifacts)));

    case "tasks": {
      const text = formatTasks(session.subagents, session.tasks, session.lang);
      if (!text) {
        return null;
      }
      return pill(colors.meta, lbl(text));
    }

    case "mode": {
      const text = formatMode(session.approvalMode, session.vimMode);
      if (!text) {
        return null;
      }
      // An approval mode like accept-edits changes what the agent may do alone.
      const approval = session.approvalMode && session.approvalMode !== "default";
      return pill(approval ? colors.caution : colors.meta, lbl(text));
    }

    case "title":
      if (!session.title) {
        return null;
      }
      return pill(colors.meta, lbl(limitWidth(session.title, widget, ascii, TITLE_MAX)));

    case "sessionTime": {
      const text = formatSessionTime(session.sessionStartMs, Date.now(), session.lang);
      return text ? pill(colors.meta, lbl(text)) : null;
    }

    case "ram": {
      const pct = session.ramPct ?? 0;
      let color = colors.meta;
      if (pct >= RAM_DANGER) {
        color = colors.warn;
      } else if (pct >= RAM_CAUTION) {
        color = colors.caution;
      }
      return pill(color, lbl(`${pct}%`));
    }

    case "version":
      if (!session.version) {
        return null;
      }
      return pill(colors.meta, lbl(`v${session.version}`));

    case "sandbox": {
      if (!session.sandbox) {
        return null;
      }
      const net = session.sandboxNet;
      const text = t(net ? "sandbox_net" : "sandbox_isolated", session.lang);
      const color = net ? colors.warn : colors.git;
      return pill(color, lbl(text, net ? "🌐" : undefined));
    }

    case "cacheRead":
      return pill(colors.meta, lbl(formatTokens(session.cacheRead)));

    case "cacheCreate":
      return pill(colors.meta, lbl(formatTokens(session.cacheCreate)));

    case "cacheHit": {
      const pct = session.cacheHitPct ?? 0;
      let color = colors.meta;
      if (pct >= 80) {
        color = colors.fiveHour;
      } else if (pct >= 50) {
        color = colors.weekly;
      }
      return pill(color, lbl(`${pct}%`));
    }

    case "totalTokens":
      if (!session.totalTokens) {
        return null;
      }
      return pill(
        colors.meta,
        lbl(
          widget?.split
            ? formatTokenSplit(session.inputTokens, session.outputTokens, ascii, session.lang)
            : formatTokens(session.totalTokens)
        )
      );

    case "tokensToday":
    case "tokensWeek": {
      const usage = formatUsage(
        session.usage?.[id === "tokensToday" ? "today" : "week"],
        widget,
        ascii,
        session.lang
      );
      if (!usage) {
        return null;
      }
      if (usage.pct === null) {
        return pill(colors.meta, lbl(usage.text));
      }
      // A budget alerts like the context widgets: caution, then danger.
      const thresh = resolveContextThresholds(widget, config);
      const level =
        usage.pct >= thresh.crit ? "crit" : usage.pct >= thresh.warn ? "warn" : "normal";
      const color = contextColor(usage.pct, colors.meta, false, {
        crit: thresh.crit,
        warn: thresh.warn,
        critColor: colors.warn,
        warnColor: colors.caution,
      });
      return pill(color, lbl(usage.text), !ascii && shouldBlink(level, thresh.blink));
    }

    case "customText": {
      if (!widget?.text) {
        return null;
      }
      return pill(colors.meta, lbl(limitWidth(widget.text, widget, ascii)));
    }

    case "exec": {
      // Only real output is cut: the [cmd] preview and blocked markers stay whole.
      const output =
        session.execMode === "run"
          ? limitWidth(execWidgetOutput(widget, session), widget, ascii)
          : execWidgetOutput(widget, session);
      if (!output) {
        return null;
      }
      const icon = widget.icon !== undefined ? widget.icon : "⚡";
      const named = widget.label || "";
      const color = colors.meta;
      if (!icon || raw) {
        return pill(color, named && !raw ? ` ${named}: ${output} ` : ` ${output} `);
      }
      return pill(color, label(emojis, icon, named, output));
    }

    default:
      return null;
  }
}

// Pill text on a gradient color that the theme's text doesn't read on.
const READABLE_TEXT = [[22, 22, 28], WHITE, [0, 0, 0]];

function buildRows(session, config, colors) {
  const rows = [];
  let groups = [];
  let current = [];
  // The widgets shown in the current row, so a gradient can be spread over
  // exactly those once the row is complete.
  let placed = [];
  const gradient = gradientStops(config.gradient);

  function styledSegment(widget, ownColors) {
    const segment = buildSegment(
      widget.id,
      session,
      ownColors,
      config.emojis,
      config.ascii === true,
      widget,
      config
    );
    if (segment) {
      segment.textColor = ownColors.text;
      segment.bold = widget.bold !== false;
      if (segment.meter) {
        segment.style = meterStyle(widget, config, "pills");
      }
    }
    return segment;
  }

  // Each widget takes its step of the gradient in place of its identity
  // color; alert colors and a widget's own color stay as they are.
  function applyGradient() {
    const shades = gradientColors(gradient, placed.length);
    placed.forEach(({ widget, group, index }, i) => {
      if (resolveColor(widget.color, colors)) {
        return;
      }
      const ownColors = widgetColors({ ...widget, color: shades[i] }, colors);
      const segment = styledSegment(widget, ownColors);
      if (!segment) {
        return;
      }
      if (!resolveColor(widget.textColor, colors)) {
        segment.textColor = readableText(segment.color, ownColors.text, READABLE_TEXT);
      }
      group[index] = segment;
    });
  }

  function flushGroup() {
    if (current.length) {
      groups.push(current);
      current = [];
    }
  }

  function flushRow() {
    flushGroup();

    if (gradient && placed.length) {
      applyGradient();
    }
    placed = [];

    if (groups.length) {
      rows.push(groups);
      groups = [];
    }
  }

  for (const widget of config.widgets) {
    if (widget.id === "lineBreak") {
      flushRow();
      continue;
    }

    if (widget.id === "separator") {
      flushGroup();
      continue;
    }

    const segment = styledSegment(widget, widgetColors(widget, colors));

    if (!segment) {
      continue;
    }

    placed.push({ widget, group: current, index: current.length });
    current.push(segment);
  }

  flushRow();
  return rows;
}

// Caps blend into the terminal background unless a theme pins one explicitly,
// so pills look right on dark and light terminals alike.
function capBackground(terminal) {
  return terminal ? bg(terminal) : bgDefault();
}

function leftCap(color, terminal, glyph) {
  return glyph ? capBackground(terminal) + fg(color) + glyph : "";
}

function rightCap(color, terminal, glyph) {
  return glyph ? fg(color) + capBackground(terminal) + glyph : "";
}

// Compared as the terminal will draw them: at 256 colors two different colors
// can land on the same code, and without color everything is the same.
function sameColor(a, b) {
  return bg(a) === bg(b);
}

// Each solid Powerline glyph (U+E0B0 to U+E0BE, even code points) has a thin
// outline twin at the next code point. The round twins are drawn shorter than
// the cell in many Nerd Fonts, so round joins use a box-drawing line, which
// spans the full height.
function thinGlyph(glyph) {
  const code = glyph.codePointAt(0);
  if (glyph.length !== 1 || code < 0xe0b0 || code > 0xe0be || code % 2 !== 0) {
    return glyph;
  }
  return code === 0xe0b4 || code === 0xe0b6 ? "│" : String.fromCodePoint(code + 1);
}

// A separator between two widgets of the same color would vanish, so it is
// drawn as its thin outline in the text color instead, the way Powerline
// divides one color. ASCII joins are characters, not shapes, so they take the
// text color too, which reads on any pill. Inverted separators (meant for
// left-pointing glyphs) take the next widget's color on the previous one's.
function joinSegments(previous, next, glyph, invert, textColor, ascii = false) {
  if (!glyph) {
    return "";
  }

  if (ascii || sameColor(previous.color, next.color)) {
    return fg(next.textColor || textColor) + bg(next.color) + thinGlyph(glyph);
  }

  return invert
    ? fg(next.color) + bg(previous.color) + glyph
    : fg(previous.color) + bg(next.color) + glyph;
}

function segmentContent(text, color, textColor, blink = false, bold = true) {
  const blinkSeq = blink ? BLINK : "";
  const blinkOff = blink ? BLINK_OFF : "";
  // NORMAL clears bold left over from a previous widget.
  const style = bg(color) + fg(textColor) + blinkSeq + (bold ? BOLD : NORMAL);
  // Only exec output with "colors": true still holds escapes here.
  return style + (text.includes("\x1b") ? restoreAfterReset(text, style) : text) + blinkOff;
}

function renderMeterSegment(segment, colors, ascii = false) {
  const displayPct = segment.isRemaining
    ? Math.max(0, Math.min(100, 100 - Number(segment.pct)))
    : segment.pct;
  const textColor = segment.textColor || colors.text;
  const meter = fillMeter(displayPct, 12, segment.fill, segment.empty, segment.color, {
    elapsedPct: segment.elapsedPct,
    ascii,
    style: segment.style,
    textColor,
  });
  const bold = segment.bold !== false;

  return (
    segmentContent(segment.prefix, segment.color, textColor, segment.blink, bold) +
    meter +
    segmentContent(segment.suffix, segment.color, textColor, segment.blink, bold)
  );
}

// Caps cycle per pill and separators per join, counted across the whole
// statusline, so lists with several glyphs alternate from left to right.
// Glyphs are drawn without bold, which some fonts draw wider or shifted, and
// the pill ends on the terminal's background so the padding after it stays
// clear even without an end cap. Without color, solid caps would be blobs of
// text color, so only ASCII brackets are kept.
function renderGroup(group, colors, config, counters = { pill: 0, separator: 0 }) {
  const { powerline } = config;
  const ascii = config.ascii === true;
  const terminal = colors.terminal;
  const pillIndex = counters.pill++;
  const caps = ascii || getActiveDepth() !== "none";
  const cap = (list, slot) => (caps ? glyphChar(pickGlyph(list, pillIndex), slot, ascii) : "");
  const startCap = cap(powerline.startCaps, "startCap");
  const endCap = cap(powerline.endCaps, "endCap");

  let out = leftCap(group[0].color, terminal, startCap);

  for (let i = 0; i < group.length; i++) {
    const segment = group[i];

    out += segment.meter
      ? renderMeterSegment(segment, colors, ascii)
      : segmentContent(
          segment.text,
          segment.color,
          segment.textColor || colors.text,
          segment.blink,
          segment.bold !== false
        );

    if (i < group.length - 1) {
      const slot = counters.separator++;
      const glyph = glyphChar(pickGlyph(powerline.separators, slot), "separator", ascii);
      const invert = powerline.separatorInvert[slot % (powerline.separators.length || 1)];
      out +=
        NORMAL + joinSegments(segment, group[i + 1], glyph, invert === true, colors.text, ascii);
    }
  }

  const last = group[group.length - 1].color;
  return out + NORMAL + (endCap ? rightCap(last, terminal, endCap) : capBackground(terminal));
}

// With joins off every widget is a pill of its own, one space from the next;
// the Flex Separator still decides where the row opens up.
function renderPills(group, colors, config, counters) {
  if (config.powerline.enabled) {
    return renderGroup(group, colors, config, counters);
  }
  return group.map((segment) => renderGroup([segment], colors, config, counters)).join(" ");
}

// Web previews ask for each gap between widget groups to be marked, so the
// page can stretch it to its own width instead of these fixed columns. These
// SGR codes mean nothing to a terminal and never reach one.
const FLEX_GAP_START = "\x1b[1000m";
const FLEX_GAP_END = "\x1b[1001m";

function joinFlex(parts, terminalWidth, markGaps = false) {
  if (parts.length <= 1) {
    return parts[0] || "";
  }

  const widths = parts.map(visibleWidth);
  const gaps = parts.length - 1;
  const minGap = 1;
  const used = widths.reduce((sum, width) => sum + width, 0) + gaps * minGap;
  const extra = Math.max(0, terminalWidth - used);
  const each = Math.floor(extra / gaps);
  let leftover = extra % gaps;
  let out = parts[0];

  for (let i = 1; i < parts.length; i++) {
    const pad = minGap + each + (leftover > 0 ? 1 : 0);

    if (leftover > 0) {
      leftover -= 1;
    }

    const gap = " ".repeat(pad);
    out += (markGaps ? FLEX_GAP_START + gap + FLEX_GAP_END : gap) + parts[i];
  }

  return out;
}

// Pills fill their whole cell, so stacked rows touch; rowGap puts a blank
// line between them. It holds a space so a host that drops empty lines keeps it.
function renderPillRows(rows, session, colors, config) {
  const counters = { pill: 0, separator: 0 };

  return rows
    .map((row) =>
      joinFlex(
        row.map((group) => renderPills(group, colors, config, counters)),
        session.terminalWidth,
        session.flexGaps === true
      )
    )
    .join(config.rowGap === true ? "\n \n" : "\n");
}

module.exports = {
  fillMeter,
  meterSegment,
  pill,
  buildSegment,
  buildRows,
  leftCap,
  rightCap,
  joinSegments,
  segmentContent,
  renderMeterSegment,
  renderGroup,
  renderPillRows,
  joinFlex,
  FLEX_GAP_START,
  FLEX_GAP_END,
};
};
__files["statusline.js"] = function (module, exports, require) {
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 agy-powerline contributors

"use strict";

const path = require("path");
const { parseArgs } = require("util");
const { readConfigFile, renderStatusline, applyRenderOverrides } = require("./shared");
const { isTrustedInstallDir } = require("./paths");
const { dumpTarget, writePayloadDump } = require("./payload-dump");
const {
  isLogEnabled,
  setLogDir,
  setLogContext,
  jsonErrorMessage,
  redact,
  logError,
  logWarning,
} = require("./log");

// A refresh slower than this is worth a line in the problem log.
const SLOW_RENDER_MS = 750;

// Antigravity can start the command and keep stdin open without writing to it
// (google-antigravity/antigravity-cli#698). A blocking read would wait until
// Antigravity kills the script, and a few kills in a row turn the custom
// statusline off, so the read gives up after this long.
const STDIN_TIMEOUT_MS = 1000;

const RENDER_OPTIONS = {
  preset: { type: "string" },
  layout: { type: "string" },
  theme: { type: "string" },
  caps: { type: "string" },
  gradient: { type: "string" },
  language: { type: "string" },
};

// The config decides whether problems are logged, so it is read first. A
// broken config can't say, so logging stays on (AGY_POWERLINE_LOG=0 still
// turns it off).
const { config, error: configError } = readConfigFile();
setLogDir(__dirname, isLogEnabled(configError ? null : config));

// Antigravity can close the pipe before the statusline finishes writing. That
// is a normal shutdown, so don't treat EPIPE as a runtime crash.
process.stdout.on("error", (err) => {
  if (err?.code === "EPIPE") {
    process.exit(0);
  }

  logError("RUNTIME_CRASH", err);
  process.stderr.write(`[agy-powerline] ${redact(err?.message || err)}\n`);
  process.exit(0);
});

// A crash must not leave a stack trace in Antigravity's status bar.
process.on("uncaughtException", (err) => {
  logError("RUNTIME_CRASH", err);
  // The message can quote payload text; redact also strips escape sequences.
  process.stderr.write(`[agy-powerline] ${redact(err?.message || err)}\n`);
  process.stdout.write("\x1b[31m[agy-powerline: error, see agy-powerline.log]\x1b[0m\n");
  process.exit(0);
});

// Resolves with what stdin sent and whether it closed before the deadline.
function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    const chunks = [];
    let done = false;
    const finish = (complete) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // An open stdin would keep the process alive after the bar is printed.
      process.stdin.destroy();
      resolve({ text: Buffer.concat(chunks).toString("utf8"), complete });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => finish(true));
    process.stdin.on("error", () => finish(true));
  });
}

readStdin(STDIN_TIMEOUT_MS).then(({ text, complete }) => {
  render(text.replace(/^\uFEFF/, "").trim(), complete);
});

function render(input, complete) {
  if (!input) {
    if (!complete) {
      logWarning("STDIN_TIMEOUT", { ms: STDIN_TIMEOUT_MS });
    }
    process.exit(0);
  }

  // Debug dumps keep only the fields the bar renders, never personal ones.
  const dumpPath =
    dumpTarget(process.env.AGY_POWERLINE_DUMP_PAYLOAD, __dirname) ||
    (process.env.AGY_POWERLINE_DEBUG ? path.join(__dirname, "last-payload.json") : null);
  if (dumpPath) {
    writePayloadDump(dumpPath, input);
  }

  let data;

  try {
    data = JSON.parse(input);
  } catch (err) {
    // Stdin was cut off by the deadline: nothing worth showing.
    if (!complete) {
      logWarning("STDIN_TIMEOUT", { ms: STDIN_TIMEOUT_MS });
      process.exit(0);
    }
    logWarning("PAYLOAD_INVALID_JSON", { message: jsonErrorMessage(err.message) });
    // Node's message quotes the bad input; only say where it broke.
    process.stderr.write(`[agy-powerline] ${jsonErrorMessage(err.message)} on stdin\n`);
    process.stdout.write("\x1b[31m[agy-powerline: invalid JSON]\x1b[0m\n");
    process.exit(0);
  }

  // The one payload value the log keeps: Antigravity's version number.
  if (typeof data?.version === "string" && /^\d[\w.+-]{0,30}$/.test(data.version)) {
    setLogContext({ antigravity: data.version });
  }

  // The config lives next to this script. A copy anywhere other than the
  // global install or AGY_POWERLINE_HOME (e.g. committed inside a repo) may be
  // edited by someone else, so its exec widgets stay off.
  const exec = isTrustedInstallDir(__dirname) ? "run" : "blocked";

  if (configError) {
    logWarning("CONFIG_INVALID", {
      message: /JSON/.test(configError) ? jsonErrorMessage(configError) : redact(configError),
    });
    process.stderr.write(`[agy-powerline] invalid statusline.config.json: ${configError}\n`);
  }

  const started = Date.now();
  const parsed = parseRenderOptions(process.argv.slice(2));
  const applied = applyRenderOverrides(config, parsed.values);
  const invalid = [...new Set([...parsed.invalid, ...applied.invalid])];

  if (invalid.length) {
    const labels = invalid.map((name) => (name === "unknown" ? "unknown option" : `--${name}`));
    logWarning("BAD_RUNTIME_FLAG", { options: invalid });
    process.stderr.write(
      `[agy-powerline] ignored invalid render override(s): ${labels.join(", ")}\n`
    );
  }

  const output = renderStatusline(data, applied.config, { exec, configError, usage: "read" });
  const elapsed = Date.now() - started;

  if (elapsed > SLOW_RENDER_MS) {
    logWarning("SLOW_RENDER", { ms: elapsed, widgets: config.widgets.map((widget) => widget.id) });
  }

  process.stdout.write(output);
}

function parseRenderOptions(args) {
  try {
    const parsed = parseArgs({
      args,
      options: RENDER_OPTIONS,
      strict: false,
      allowPositionals: true,
      tokens: true,
    });
    const known = new Set(Object.keys(RENDER_OPTIONS));
    const unknown = parsed.tokens.some(
      (token) => token.kind === "option" && !known.has(token.name)
    );
    return { values: parsed.values, invalid: unknown ? ["unknown"] : [] };
  } catch {
    return { values: {}, invalid: ["unknown"] };
  }
}
};
__require("statusline.js", "./log").setBundleLines([[26,"shared.js"],[266,"colors.js"],[630,"themes.js"],[1191,"config.js"],[1710,"formatters.js"],[2500,"git.js"],[3284,"session.js"],[3723,"paths.js"],[4185,"exec.js"],[4542,"powerline.js"],[4751,"widget-style.js"],[5069,"fit.js"],[5266,"log.js"],[5580,"payload-dump.js"],[5778,"usage.js"],[6308,"i18n.js"],[6502,"layouts/lines.js"],[7315,"layouts/pills.js"],[8375,"statusline.js"]]);
__require("statusline.js", "./statusline");

/*
Based on https://github.com/wassim-azi/agy-powerline

MIT License

Copyright (c) 2026 agy-powerline contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
