"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOME = process.env.HOME || process.env.USERPROFILE || "";
const LICENSE_PATH = path.join(HOME, ".aigentry", "license.json");

// Tier definitions from EntitlementContract v0.1.0
const TIERS = {
  free: {
    display_name: "Free",
    limits: {
      max_sessions: 3,
      max_brain_entries: 10000,
      max_experiments_per_day: 10,
      max_deliberation_speakers: 3,
      max_amplify_posts_per_day: 5,
      max_dustcraw_sources: 10,
      cloud_sync: false,
      team_features: false,
    },
  },
  pro: {
    display_name: "Pro",
    limits: {
      max_sessions: Infinity,
      max_brain_entries: Infinity,
      max_experiments_per_day: Infinity,
      max_deliberation_speakers: Infinity,
      max_amplify_posts_per_day: Infinity,
      max_dustcraw_sources: Infinity,
      cloud_sync: true,
      team_features: false,
    },
  },
  team: {
    display_name: "Team",
    limits: {
      max_sessions: Infinity,
      max_brain_entries: Infinity,
      max_experiments_per_day: Infinity,
      max_deliberation_speakers: Infinity,
      max_amplify_posts_per_day: Infinity,
      max_dustcraw_sources: Infinity,
      cloud_sync: true,
      team_features: true,
      max_team_members: 50,
      shared_brain: true,
      audit_log: true,
      sso: true,
    },
  },
};

// Feature entitlements: feature_key -> { tiers: [...], free_limit?: number|string }
const FEATURES = {
  // telepty
  "telepty.core": { tiers: ["free", "pro", "team"] },
  "telepty.multi_session": { tiers: ["pro", "team"], free_limit: 3 },
  "telepty.remote_sessions": { tiers: ["pro", "team"] },
  "telepty.team_broadcast": { tiers: ["team"] },
  // brain
  "brain.core": { tiers: ["free", "pro", "team"] },
  "brain.sync": { tiers: ["pro", "team"] },
  "brain.export": { tiers: ["free", "pro", "team"] },
  "brain.session_handoff": { tiers: ["pro", "team"] },
  "brain.shared_workspace": { tiers: ["team"] },
  "brain.advanced_search": { tiers: ["pro", "team"], free_fallback: "keyword-only search" },
  "brain.compact": { tiers: ["free", "pro", "team"] },
  "brain.experiment": { tiers: ["pro", "team"] },
  // deliberation
  "deliberation.core": { tiers: ["free", "pro", "team"] },
  "deliberation.multi_session": { tiers: ["pro", "team"], free_limit: 1 },
  "deliberation.browser_integration": { tiers: ["pro", "team"] },
  "deliberation.auto_run": { tiers: ["pro", "team"] },
  "deliberation.remote": { tiers: ["pro", "team"] },
  "deliberation.decision_engine": { tiers: ["pro", "team"] },
  "deliberation.code_review": { tiers: ["pro", "team"] },
  "deliberation.unlimited_speakers": { tiers: ["pro", "team"], free_limit: 3 },
  // dustcraw
  "dustcraw.core": { tiers: ["free", "pro", "team"] },
  "dustcraw.express_mode": { tiers: ["free", "pro", "team"] },
  "dustcraw.standard_mode": { tiers: ["pro", "team"] },
  "dustcraw.unlimited_sources": { tiers: ["pro", "team"], free_limit: 10 },
  "dustcraw.auto_daemon": { tiers: ["pro", "team"] },
  "dustcraw.strategy_optimizer": { tiers: ["pro", "team"] },
  // amplify
  "amplify.core": { tiers: ["free", "pro", "team"] },
  "amplify.multi_platform": { tiers: ["pro", "team"], free_limit: "1 platform" },
  "amplify.scheduled_publishing": { tiers: ["pro", "team"] },
  "amplify.analytics": { tiers: ["pro", "team"] },
  "amplify.team_workflow": { tiers: ["team"] },
  // registry
  "registry.core": { tiers: ["free", "pro", "team"] },
  "registry.leaderboard": { tiers: ["free", "pro", "team"] },
  "registry.private_agents": { tiers: ["pro", "team"] },
  "registry.team_registry": { tiers: ["team"] },
  "registry.api_access": { tiers: ["pro", "team"] },
  // devkit
  "devkit.core": { tiers: ["free", "pro", "team"] },
  "devkit.autoresearch_mode": { tiers: ["pro", "team"] },
  "devkit.custom_agents": { tiers: ["pro", "team"] },
};

const UPGRADE_URL = "https://aigentry.dev/upgrade";

/**
 * Load license from ~/.aigentry/license.json
 * Returns license object or null
 */
function loadLicense() {
  try {
    const raw = fs.readFileSync(LICENSE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save license to ~/.aigentry/license.json
 */
function saveLicense(license) {
  const dir = path.dirname(LICENSE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(LICENSE_PATH, JSON.stringify(license, null, 2) + "\n", { mode: 0o600 });
}

/**
 * Generate a free tier license
 */
function generateFreeLicense() {
  const license = {
    tier: "free",
    issued_at: new Date().toISOString(),
    expires_at: null,
    features: [],
    disabled_features: [],
    signature: crypto.randomBytes(32).toString("hex"),
  };
  saveLicense(license);
  return license;
}

/**
 * Get current tier from license
 */
function getCurrentTier() {
  const license = loadLicense();
  if (!license) return "free";

  // Check expiration (30-day grace period)
  if (license.expires_at) {
    const expiry = new Date(license.expires_at);
    const gracePeriod = new Date(expiry.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (new Date() > gracePeriod) return "free";
  }

  return license.tier || "free";
}

/**
 * Check entitlement for a feature
 * @param {object} params - { feature: string }
 * @returns {{ allowed: boolean, tier: string, reason?: string, upgrade_url?: string, limit?: { current?: number, max?: number } }}
 */
function checkEntitlement({ feature }) {
  const tier = getCurrentTier();
  const license = loadLicense();
  const featureDef = FEATURES[feature];

  // Unknown feature: deny
  if (!featureDef) {
    return {
      allowed: false,
      tier,
      reason: `Unknown feature: ${feature}`,
    };
  }

  // Check explicit overrides in license
  if (license?.features?.includes(feature)) {
    return { allowed: true, tier };
  }
  if (license?.disabled_features?.includes(feature)) {
    return {
      allowed: false,
      tier,
      reason: "Feature explicitly disabled by admin",
    };
  }

  // Check tier access
  if (featureDef.tiers.includes(tier)) {
    return { allowed: true, tier };
  }

  // Denied: build reason
  const minTier = featureDef.tiers[0]; // lowest tier that has access
  const result = {
    allowed: false,
    tier,
    reason: `Requires ${TIERS[minTier]?.display_name || minTier} tier`,
    upgrade_url: UPGRADE_URL,
  };

  if (featureDef.free_limit !== undefined) {
    result.reason = `Free tier limit: ${featureDef.free_limit}`;
    if (typeof featureDef.free_limit === "number") {
      result.limit = { max: featureDef.free_limit };
    }
  }

  return result;
}

/**
 * Get tier display info
 */
function getTierInfo(tierName) {
  return TIERS[tierName] || null;
}

/**
 * Get all features for a given tier
 */
function getFeaturesForTier(tierName) {
  return Object.entries(FEATURES)
    .filter(([, def]) => def.tiers.includes(tierName))
    .map(([key]) => key);
}

module.exports = {
  loadLicense,
  saveLicense,
  generateFreeLicense,
  getCurrentTier,
  checkEntitlement,
  getTierInfo,
  getFeaturesForTier,
  TIERS,
  FEATURES,
  LICENSE_PATH,
  UPGRADE_URL,
};
