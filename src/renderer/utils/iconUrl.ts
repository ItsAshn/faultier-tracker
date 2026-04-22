let _version = 0

export function getIconUrl(type: 'app' | 'group', id: number): string {
  return `kioku://icon/${type}/${id}?v=${_version}`
}

export function bumpIconVersion(): void {
  _version++
}