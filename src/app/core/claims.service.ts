import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type { ClaimCase, ClaimFilters, PagedClaims } from './models'
import type { CoBatch } from './co-insurance.models'

@Injectable({ providedIn: 'root' })
export class ClaimsService {
  constructor(private readonly http: HttpClient) {}

  list(filters: ClaimFilters) {
    const params = new HttpParams()
      .set('query', filters.query)
      .set('status', filters.status)
      .set('risk', filters.risk)
      .set('page', filters.page)
      .set('pageSize', filters.pageSize)
    return this.http.get<PagedClaims>('/api/claims', { params })
  }

  get(id: string) {
    return this.http.get<ClaimCase>(`/api/claims/${id}`)
  }

  addQuote(claimId: string, body: { itemId: string; amount: number; reason: string }) {
    return this.http.post(`/api/claims/${claimId}/quotes`, body)
  }

  approve(claimId: string, body: { role: string; result: string; comment: string }) {
    return this.http.post(`/api/claims/${claimId}/approvals`, body)
  }

  /** 共保分摊批次：按事故号拉取 */
  listCoBatches() {
    return this.http.get<{ items: CoBatch[] }>('/api/co-batches')
  }

  getCoBatch(accidentNo: string) {
    return this.http.get<CoBatch>(`/api/co-batches/${accidentNo}`)
  }

  /**
   * 提交共保分摊批次。
   * simulateFail=true 时模拟写入失败（如网络/服务端故障），调用方据此走本地恢复重试。
   * 服务端按 dedupeKey 对审计去重，重试不会重复追加审计。
   */
  saveCoBatch(batch: CoBatch, simulateFail: boolean) {
    const headers = simulateFail ? new HttpHeaders({ 'X-Simulate-Fail': '1' }) : undefined
    return this.http.post<CoBatch>('/api/co-batches', batch, { headers })
  }
}
