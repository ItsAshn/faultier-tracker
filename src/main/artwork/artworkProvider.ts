import { net } from 'electron'
import type { ArtworkResult } from '@shared/types'

const SGDB_BASE = 'https://www.steamgriddb.com/api/v2'

type ArtType = 'grids' | 'heroes' | 'logos' | 'icons'

interface SgdbGame {
  id: number
  name: string
}

interface SgdbImage {
  id: number
  url: string
  thumb: string
  width: number
  height: number
  style: string
  mime: string
}

interface SgdbSearchResponse {
  success: boolean
  data: SgdbGame[]
}

interface SgdbImagesResponse {
  success: boolean
  data: SgdbImage[]
}

export async function searchSteamGridDB(
  query: string,
  apiKey: string,
  type: ArtType = 'grids'
): Promise<ArtworkResult[]> {
  const headers = { Authorization: `Bearer ${apiKey}` }

  // Step 1: find game/app by name
  const searchRes = await net.fetch(
    `${SGDB_BASE}/search/autocomplete/${encodeURIComponent(query)}`,
    { headers }
  )

  if (searchRes.status === 401) {
    throw new Error('Invalid SteamGridDB API key.')
  }
  if (!searchRes.ok) {
    throw new Error(`SteamGridDB search failed (HTTP ${searchRes.status}).`)
  }

  const searchData = (await searchRes.json()) as SgdbSearchResponse
  if (!searchData.success || !searchData.data?.length) return []

  const gameId = searchData.data[0].id

  // Step 2: fetch images of the requested type
  const imagesRes = await net.fetch(
    `${SGDB_BASE}/${type}/game/${gameId}`,
    { headers }
  )

  if (!imagesRes.ok) return []

  const imagesData = (await imagesRes.json()) as SgdbImagesResponse
  if (!imagesData.success || !imagesData.data?.length) return []

  return imagesData.data.map((img) => ({
    id: img.id,
    url: img.url,
    thumb: img.thumb,
    width: img.width,
    height: img.height,
    style: img.style,
    mime: img.mime,
  }))
}
