import crypto from 'crypto'

const BINANCE_FUTURES_URL = 'https://fapi.binance.com'

interface BinanceConfig {
  apiKey: string
  apiSecret: string
}

function getConfig(): BinanceConfig {
  const apiKey = process.env.BINANCE_API_KEY || ''
  const apiSecret = process.env.BINANCE_API_SECRET || ''
  return { apiKey, apiSecret }
}

function sign(queryString: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(queryString)
    .digest('hex')
}

async function signedRequest(endpoint: string, params: Record<string, string | number> = {}) {
  const config = getConfig()
  
  if (!config.apiKey || !config.apiSecret) {
    throw new Error('Binance API credentials not configured')
  }

  const timestamp = Date.now()
  const queryParams = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    timestamp: String(timestamp),
  })
  
  const signature = sign(queryParams.toString(), config.apiSecret)
  queryParams.append('signature', signature)

  const response = await fetch(`${BINANCE_FUTURES_URL}${endpoint}?${queryParams.toString()}`, {
    headers: {
      'X-MBX-APIKEY': config.apiKey,
    },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Binance API error: ${error.msg || response.statusText}`)
  }

  return response.json()
}

export async function getAccountBalance() {
  try {
    const data = await signedRequest('/fapi/v2/balance')
    return data
  } catch (error) {
    console.error('Failed to get account balance:', error)
    return null
  }
}

export async function getPositions() {
  try {
    const data = await signedRequest('/fapi/v2/positionRisk')
    // Filter only active positions (non-zero quantity)
    return data.filter((p: { positionAmt: string }) => parseFloat(p.positionAmt) !== 0)
  } catch (error) {
    console.error('Failed to get positions:', error)
    return []
  }
}

export async function getAccountInfo() {
  try {
    const data = await signedRequest('/fapi/v2/account')
    return {
      totalWalletBalance: parseFloat(data.totalWalletBalance),
      totalUnrealizedProfit: parseFloat(data.totalUnrealizedProfit),
      totalMarginBalance: parseFloat(data.totalMarginBalance),
      availableBalance: parseFloat(data.availableBalance),
      totalPositionInitialMargin: parseFloat(data.totalPositionInitialMargin),
    }
  } catch (error) {
    console.error('Failed to get account info:', error)
    return null
  }
}

export async function getTradeHistory(symbol?: string, limit: number = 100) {
  try {
    const params: Record<string, string | number> = { limit }
    if (symbol) params.symbol = symbol
    
    const data = await signedRequest('/fapi/v1/userTrades', params)
    return data
  } catch (error) {
    console.error('Failed to get trade history:', error)
    return []
  }
}

export async function getIncomeHistory(incomeType?: string, limit: number = 100) {
  try {
    const params: Record<string, string | number> = { limit }
    if (incomeType) params.incomeType = incomeType
    
    const data = await signedRequest('/fapi/v1/income', params)
    return data
  } catch (error) {
    console.error('Failed to get income history:', error)
    return []
  }
}

// Check if Binance API is configured
export function isConfigured(): boolean {
  const config = getConfig()
  return Boolean(config.apiKey && config.apiSecret)
}
