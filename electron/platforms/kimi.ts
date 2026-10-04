import * as https from 'https'
import { BalanceData } from '../tokenStore'

const PLATFORM_ID = 'kimi'
const PLATFORM_NAME = 'Kimi'
const API_HOST = 'api.moonshot.cn'
const API_PATH = '/v1/users/me/balance'

const adapter = {
  id: PLATFORM_ID,
  name: PLATFORM_NAME,
  description: 'Kimi 开放平台（月之暗面）',
  website: 'https://platform.kimi.com/console/api-keys',
  rechargeUrl: 'https://platform.kimi.com/console/pay',
  currency: 'CNY',
  credentialType: 'api_key',
  credentialHint: '',
  isTokenQuota: false,

  getBalance(apiKey: string): Promise<BalanceData> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: API_HOST,
        path: API_PATH,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        timeout: 10000,
      }

      const req = https.request(options, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          try {
            const result = JSON.parse(data)

            if (res.statusCode === 200 && result.code === 0) {
              const balanceData = result.data || {}
              const availableBalance = balanceData.available_balance || 0
              const voucherBalance = balanceData.voucher_balance || 0
              const cashBalance = balanceData.cash_balance || 0

              resolve({
                isAvailable: availableBalance > 0,
                currency: 'CNY',
                totalBalance: availableBalance,
                grantedBalance: voucherBalance,
                toppedUpBalance: cashBalance,
              })
            } else if (res.statusCode === 401) {
              reject(new Error('API Key 无效，请检查您的 Key 是否正确（注意国内站和国际站 Key 不通用）'))
            } else {
              const errorMsg = result.error?.message || result.message || data
              reject(new Error(`请求失败 (${res.statusCode}): ${errorMsg}`))
            }
          } catch (e) {
            reject(new Error(`解析响应失败: ${(e as Error).message}`))
          }
        })
      })

      req.on('error', (e) => {
        reject(new Error(`网络错误: ${e.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('请求超时，请检查网络连接'))
      })

      req.end()
    })
  },
}

export default adapter
