/**
 * Steam library discovery and .acf manifest index.
 *
 * Reads the Windows registry to locate the Steam installation, parses
 * `libraryfolders.vdf` to find all Steam library roots across drives, then
 * scans each root's `appmanifest_*.acf` files to build a deterministic
 * installdir → appId map.  This lets the tracker suppress duplicate tracking
 * of games whose exe name bears no resemblance to the Steam display name
 * (e.g. "sotgame.exe" ↔ Sea of Thieves).
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AcfEntry {
  appId: number;
  /** Raw installdir value from the .acf file, e.g. "Sea Of Thieves" */
  installDir: string;
  /** Normalized (lowercase, strip non-alnum) version of installDir */
  installDirNorm: string;
  /** Path to the game folder: <libraryRoot>/steamapps/common/<installDir> */
  gameFolderPath: string;
}

// ── In-memory index ──────────────────────────────────────────────────────────

/** Map from normalized installDir → AcfEntry */
let _installDirIndex: Map<string, AcfEntry> = new Map();

/** Map from Steam appId → AcfEntry */
let _appIdIndex: Map<number, AcfEntry> = new Map();

let _indexBuilt = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Read the Steam install path from the Windows registry.
 * Returns null if Steam is not installed or the registry query fails.
 */
function getSteamInstallPath(): string | null {
  const keys = [
    "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Valve\\Steam",
    "HKEY_LOCAL_MACHINE\\SOFTWARE\\Valve\\Steam",
    "HKEY_CURRENT_USER\\Software\\Valve\\Steam",
  ];

  for (const key of keys) {
    try {
      const output = execSync(`reg query "${key}" /v InstallPath 2>nul`, {
        windowsHide: true,
        encoding: "utf8",
      });
      // Output format: "    InstallPath    REG_SZ    C:\Program Files (x86)\Steam"
      const match = /InstallPath\s+REG_SZ\s+(.+)/i.exec(output);
      if (match) {
        const installPath = match[1].trim();
        if (fs.existsSync(installPath)) return installPath;
      }
    } catch {
      // key not found, try next
    }
  }
  return null;
}

/**
 * Parse a VDF text file and extract all string values matching a simple
 * key→value pattern.  This is "good enough" for the flat sections we need
 * (libraryfolders.vdf and appmanifest_*.acf are both simple flat KV files).
 *
 * Returns a Map<key, value> with all pairs found.
 */
function parseVdfKv(content: string): Map<string, string> {
  const result = new Map<string, string>();
  // Match: optional whitespace, "key", whitespace, "value"
  const re = /"([^"]+)"\s+"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    result.set(m[1].toLowerCase(), m[2]);
  }
  return result;
}

/**
 * Discover all Steam library root paths by reading libraryfolders.vdf.
 * Always includes the default <steamPath>/steamapps path.
 */
function discoverLibraryRoots(steamPath: string): string[] {
  const roots: string[] = [];

  // Default library is always steamapps/ inside the Steam install
  const defaultRoot = path.join(steamPath, "steamapps");
  if (fs.existsSync(defaultRoot)) roots.push(defaultRoot);

  // Additional libraries listed in libraryfolders.vdf
  const vdfPath = path.join(defaultRoot, "libraryfolders.vdf");
  if (fs.existsSync(vdfPath)) {
    try {
      const content = fs.readFileSync(vdfPath, "utf8");
      const kv = parseVdfKv(content);
      // The vdf has numeric keys ("1", "2", ...) whose values are paths
      // In newer Steam the key is "path" nested under each numbered section —
      // we capture both patterns since we parse all kv pairs flatly.
      for (const [key, value] of kv) {
        // Numeric-indexed library paths (older format)
        if (/^\d+$/.test(key) && value.includes(path.sep)) {
          const libRoot = path.join(value, "steamapps");
          if (fs.existsSync(libRoot) && !roots.includes(libRoot)) {
            roots.push(libRoot);
          }
        }
        // "path" key (newer format inside each library entry)
        if (key === "path" && value.length > 2) {
          const libRoot = path.join(value, "steamapps");
          if (fs.existsSync(libRoot) && !roots.includes(libRoot)) {
            roots.push(libRoot);
          }
        }
      }
    } catch (err) {
      console.warn("[SteamLibrary] Failed to parse libraryfolders.vdf:", err);
    }
  }

  return roots;
}

/**
 * Scan a single steamapps directory for appmanifest_*.acf files and add
 * entries to the index maps.
 */
function indexLibraryRoot(
  steamappsPath: string,
  installDirIndex: Map<string, AcfEntry>,
  appIdIndex: Map<number, AcfEntry>,
): void {
  let files: string[];
  try {
    files = fs.readdirSync(steamappsPath).filter((f) =>
      /^appmanifest_\d+\.acf$/i.test(f),
    );
  } catch (err) {
    console.warn(`[SteamLibrary] Cannot read directory ${steamappsPath}:`, err);
    return;
  }

  for (const file of files) {
    try {
      const filePath = path.join(steamappsPath, file);
      const content = fs.readFileSync(filePath, "utf8");
      const kv = parseVdfKv(content);

      const appIdStr = kv.get("appid");
      const installDir = kv.get("installdir");
      if (!appIdStr || !installDir) continue;

      const appId = parseInt(appIdStr, 10);
      if (isNaN(appId) || appId <= 0) continue;

      const entry: AcfEntry = {
        appId,
        installDir,
        installDirNorm: normalize(installDir),
        gameFolderPath: path.join(steamappsPath, "common", installDir),
      };

      installDirIndex.set(entry.installDirNorm, entry);
      appIdIndex.set(appId, entry);
    } catch (err) {
      console.warn(`[SteamLibrary] Failed to parse ${file}:`, err);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build (or rebuild) the ACF manifest index.  Safe to call multiple times —
 * subsequent calls refresh the index from disk.
 */
export function refreshSteamLibraryIndex(): void {
  const newInstallDir: Map<string, AcfEntry> = new Map();
  const newAppId: Map<number, AcfEntry> = new Map();

  try {
    const steamPath = getSteamInstallPath();
    if (!steamPath) {
      _installDirIndex = newInstallDir;
      _appIdIndex = newAppId;
      _indexBuilt = true;
      return;
    }

    const roots = discoverLibraryRoots(steamPath);

    for (const root of roots) {
      indexLibraryRoot(root, newInstallDir, newAppId);
    }

    _installDirIndex = newInstallDir;
    _appIdIndex = newAppId;
    _indexBuilt = true;
  } catch (err) {
    console.error("[SteamLibrary] Failed to build index:", err);
    // On unexpected error keep whatever index we had before (or empty)
    _indexBuilt = true;
  }
}

/**
 * Look up an AcfEntry by the normalized installDir extracted from an exe path.
 * For a path like "C:\...\steamapps\common\Sea Of Thieves\sotgame.exe",
 * pass folderNorm = normalize("Sea Of Thieves") = "seaofthieves".
 */
export function lookupByInstallDirNorm(folderNorm: string): AcfEntry | null {
  if (!_indexBuilt) refreshSteamLibraryIndex();
  return _installDirIndex.get(folderNorm) ?? null;
}

/**
 * Look up an AcfEntry by Steam App ID.
 */
export function lookupByAppId(appId: number): AcfEntry | null {
  if (!_indexBuilt) refreshSteamLibraryIndex();
  return _appIdIndex.get(appId) ?? null;
}

/**
 * Returns true if the index has been built at least once.
 */
export function isIndexBuilt(): boolean {
  return _indexBuilt;
}

/**
 * Returns all entries in the index (useful for startup duplicate scan).
 */
export function getAllAcfEntries(): AcfEntry[] {
  if (!_indexBuilt) refreshSteamLibraryIndex();
  return Array.from(_appIdIndex.values());
}
