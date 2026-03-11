import { readFileSync } from "fs";
import { resolve } from "path";

// Load the exe names database
let exeNames: Record<string, string> = {};

try {
  const jsonPath = resolve(__dirname, "../../shared/exeNames.json");
  const jsonContent = readFileSync(jsonPath, "utf-8");
  exeNames = JSON.parse(jsonContent);
} catch (err) {
  console.warn("[exeNameResolver] Could not load exeNames.json:", err);
}

/**
 * Get a human-readable display name for an exe file.
 * Priority: 1) JSON database, 2) Windows file metadata (if available), 3) Derived from exe name
 */
export function getDisplayNameFromExe(exeName: string): string {
  const lowerExeName = exeName.toLowerCase();
  
  // 1. Check JSON database (priority)
  if (exeNames[lowerExeName]) {
    return exeNames[lowerExeName];
  }
  
  // 2. Try to extract from file metadata (if we had access to Windows file properties)
  // This would require native Windows API calls - for now, skip this step
  // TODO: Implement Windows file description extraction if needed
  
  // 3. Derive from exe name (fallback)
  return deriveDisplayName(exeName);
}

/**
 * Derive a display name from the exe filename.
 * Converts "my-awesome-game.exe" to "My Awesome Game"
 */
function deriveDisplayName(exeName: string): string {
  return exeName
    .replace(/\.exe$/i, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
