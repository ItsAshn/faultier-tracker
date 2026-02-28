// Built-in known-app grouping rules.
// These are checked before fuzzy matching.

export interface KnownAppRule {
  groupName: string
  patterns: RegExp[]
}

export const KNOWN_APP_RULES: KnownAppRule[] = [
  { groupName: 'Blender', patterns: [/^blender/i] },
  { groupName: 'VS Code', patterns: [/^code$/i, /^code - insiders/i, /^vscodium/i, /^code\.exe$/i] },
  { groupName: 'Google Chrome', patterns: [/^chrome\.exe$/i, /^chrome$/i, /^chromium/i] },
  { groupName: 'Firefox', patterns: [/^firefox/i] },
  { groupName: 'Microsoft Edge', patterns: [/^msedge/i, /^microsoftedge/i] },
  { groupName: 'Discord', patterns: [/^discord/i] },
  { groupName: 'Slack', patterns: [/^slack/i] },
  { groupName: 'Spotify', patterns: [/^spotify/i] },
  { groupName: 'Steam', patterns: [/^steam\.exe$/i, /^steamwebhelper/i] },
  { groupName: 'Epic Games', patterns: [/^epicgameslauncher/i, /^unrealengine/i] },
  { groupName: 'OBS Studio', patterns: [/^obs64/i, /^obs32/i, /^obs\.exe$/i] },
  { groupName: 'Adobe Photoshop', patterns: [/^photoshop/i] },
  { groupName: 'Adobe Premiere', patterns: [/^premiere/i, /^adobepremiere/i] },
  { groupName: 'Adobe After Effects', patterns: [/^afterfx/i, /^after effects/i] },
  { groupName: 'Adobe Illustrator', patterns: [/^illustrator/i] },
  { groupName: 'DaVinci Resolve', patterns: [/^davinci/i, /^resolve/i] },
  { groupName: 'Unity', patterns: [/^unity(hub)?/i] },
  { groupName: 'Unreal Engine', patterns: [/^unrealengine/i, /^ue4editor/i, /^ue5editor/i] },
  { groupName: 'Figma', patterns: [/^figma/i] },
  { groupName: 'Notion', patterns: [/^notion/i] },
  { groupName: 'Obsidian', patterns: [/^obsidian/i] },
  { groupName: 'VLC', patterns: [/^vlc/i] },
  { groupName: 'Windows Explorer', patterns: [/^explorer\.exe$/i] },
  { groupName: 'Task Manager', patterns: [/^taskmgr/i] },
  { groupName: 'PowerShell', patterns: [/^powershell/i, /^pwsh/i] },
  { groupName: 'Command Prompt', patterns: [/^cmd\.exe$/i] },
  { groupName: 'Windows Terminal', patterns: [/^windowsterminal/i, /^wt\.exe$/i] },
  { groupName: 'Notepad', patterns: [/^notepad/i] },
  { groupName: 'Microsoft Word', patterns: [/^winword/i] },
  { groupName: 'Microsoft Excel', patterns: [/^excel/i] },
  { groupName: 'Microsoft PowerPoint', patterns: [/^powerpnt/i] },
  { groupName: 'Zoom', patterns: [/^zoom/i] },
  { groupName: 'Teams', patterns: [/^teams/i] },
  { groupName: 'Rider', patterns: [/^rider/i, /^rider64/i] },
  { groupName: 'CLion', patterns: [/^clion/i, /^clion64/i] },
  { groupName: 'PyCharm', patterns: [/^pycharm/i] },
  { groupName: 'IntelliJ IDEA', patterns: [/^idea/i, /^idea64/i] },
  { groupName: 'WebStorm', patterns: [/^webstorm/i] },
  { groupName: 'Godot', patterns: [/^godot/i] },
  { groupName: 'Krita', patterns: [/^krita/i] },
  { groupName: 'GIMP', patterns: [/^gimp/i] },
  { groupName: 'Audacity', patterns: [/^audacity/i] },
  { groupName: 'VirtualBox', patterns: [/^virtualbox/i, /^vboxmanage/i] },
  { groupName: 'VMware', patterns: [/^vmware/i] },
  { groupName: 'Git', patterns: [/^git\.exe$/i, /^git-bash/i] },
]

// Regex patterns for stripping version suffixes from exe names
export const VERSION_SUFFIX_PATTERNS: RegExp[] = [
  /[\s\-_v](\d+[\.\d]*)(\s*(alpha|beta|rc|lts|stable|preview))?$/i,
  /\s+\d{4}$/,                          // "App 2024"
  /[\s\-_](x64|x86|64[\-_]?bit|32[\-_]?bit)$/i,
  /\s+\(64[\-_]?bit\)$/i,
  /[\s\-_](installer|setup|portable)$/i,
]
