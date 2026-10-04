import { HttpClient } from '@angular/common/http'
import { Injectable } from '@angular/core'
import type { CoinsuranceBatch } from './models'

export type RegistrationPayload = {
  subjectKey: string
  policyNo: string
  insurer: string
  share: number
  deductible: number
  submittedBy: string
  auditId: string
}

export type ShareUpdatePayload = {
  subjectKey: string
  policyNo: string
  share: number
  deductible: number
  reason: string
  operator: string
  auditId: string
}

export type OpinionPayload = {
  subjectKey: string
  role: string
  result: string
  comment: string
  operator: string
  auditId: string
}

export type BackfillPayload = {
  subjectKey: string
  policyNo: string
  share: number
  deductible: number
  operator: string
  auditId: string
}

export type ReviewPayload = {
  comment: string
  operator: string
  auditId: string
}

@Injectable({ providedIn: 'root' })
export class CoinsuranceService {
  constructor(private readonly http: HttpClient) {}

  listBatches() {
    return this.http.get<CoinsuranceBatch[]>('/api/coinsurance/batches')
  }

  registerSubject(accidentNo: string, body: RegistrationPayload) {
    return this.http.post<CoinsuranceBatch>(`/api/coinsurance/batches/${accidentNo}/registrations`, body)
  }

  updateShare(accidentNo: string, body: ShareUpdatePayload) {
    return this.http.post<CoinsuranceBatch>(`/api/coinsurance/batches/${accidentNo}/shares`, body)
  }

  addOpinion(accidentNo: string, body: OpinionPayload) {
    return this.http.post<CoinsuranceBatch>(`/api/coinsurance/batches/${accidentNo}/opinions`, body)
  }

  backfillShare(accidentNo: string, body: BackfillPayload) {
    return this.http.post<CoinsuranceBatch>(`/api/coinsurance/batches/${accidentNo}/backfill`, body)
  }

  review(accidentNo: string, body: ReviewPayload) {
    return this.http.post<CoinsuranceBatch>(`/api/coinsurance/batches/${accidentNo}/review`, body)
  }
}
