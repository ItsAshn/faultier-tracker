// IPC channel name constants shared between main process, preload, and renderer.

export const CHANNELS = {
  // Apps
  APPS_GET_ALL: 'apps:getAll',
  APPS_UPDATE: 'apps:update',
  APPS_SET_TRACKED: 'apps:setTracked',
  APPS_SET_GROUP: 'apps:setGroup',

  // Groups
  GROUPS_GET_ALL: 'groups:getAll',
  GROUPS_CREATE: 'groups:create',
  GROUPS_UPDATE: 'groups:update',
  GROUPS_DELETE: 'groups:delete',
  GROUPS_REANALYZE: 'groups:reanalyze',

  // Sessions / stats
  SESSIONS_GET_RANGE: 'sessions:getRange',
  SESSIONS_GET_APP_RANGE: 'sessions:getAppRange',
  SESSIONS_CLEAR_ALL: 'sessions:clearAll',

  // Settings
  SETTINGS_GET_ALL: 'settings:getAll',
  SETTINGS_SET: 'settings:set',

  // Icons
  ICONS_GET_FOR_APP: 'icons:getForApp',
  ICONS_GET_FOR_GROUP: 'icons:getForGroup',
  ICONS_SET_CUSTOM: 'icons:setCustom',
  ICONS_CLEAR_CUSTOM: 'icons:clearCustom',
  ICONS_FETCH_URL: 'icons:fetchUrl',

  // Artwork search
  ARTWORK_SEARCH: 'artwork:search',

  // Data transfer
  DATA_EXPORT: 'data:export',
  DATA_IMPORT: 'data:import',
  DATA_STEAM_IMPORT: 'data:steamImport',

  // Window
  WINDOW_CONTROL: 'window:control',

  // Push from main → renderer (one-way via webContents.send)
  TRACKING_APP_SEEN: 'tracking:appSeen',
  TRACKING_TICK: 'tracking:tick',
  APPS_ARTWORK_UPDATED: 'apps:artworkUpdated',

  // Updater — invoke (renderer → main)
  UPDATE_CHECK:            'update:check',
  UPDATE_DOWNLOAD:         'update:download',
  UPDATE_QUIT_AND_INSTALL: 'update:quitAndInstall',

  // Updater — push (main → renderer)
  UPDATE_AVAILABLE:        'update:available',
  UPDATE_NOT_AVAILABLE:    'update:notAvailable',
  UPDATE_DOWNLOAD_PROGRESS:'update:downloadProgress',
  UPDATE_DOWNLOADED:       'update:downloaded',
  UPDATE_ERROR:            'update:error',
} as const

export type ChannelKey = keyof typeof CHANNELS
export type ChannelValue = (typeof CHANNELS)[ChannelKey]
