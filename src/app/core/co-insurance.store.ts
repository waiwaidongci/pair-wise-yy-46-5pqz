import { createAction, createReducer, createSelector, on, props } from '@ngrx/store'
import { seedCoBatches } from './co-insurance.seed'
import {
  addCountersign,
  backfillShares,
  refreshBatch,
  restoreDraft,
  submitRegistration,
} from './co-insurance.logic'
import type { CoBatch } from './co-insurance.models'

export type CoInsuranceState = {
  batches: Record<string, CoBatch>
  accidentNos: string[]
  activeAccidentNo: string
  saving: boolean
  lastSavedAt: string
  submitError: string
}

export type AppState = { coInsurance: CoInsuranceState }

const normalized = seedCoBatches.map((batch) => refreshBatch(batch))

export const initialCoInsuranceState: CoInsuranceState = {
  batches: Object.fromEntries(normalized.map((batch) => [batch.accidentNo, batch])),
  accidentNos: normalized.map((batch) => batch.accidentNo),
  activeAccidentNo: normalized[0]?.accidentNo ?? '',
  saving: false,
  lastSavedAt: '',
  submitError: '',
}

export const loadCoBatchesSuccess = createAction('[Co] Load Batches Success', props<{ batches: CoBatch[] }>())
export const selectAccident = createAction('[Co] Select Accident', props<{ accidentNo: string }>())
export const registrationSubmitted = createAction(
  '[Co] Registration Submitted',
  props<{ accidentNo: string; itemId: string; policyNo: string; share: number; deductible: number; operator: string }>(),
)
export const countersignAdded = createAction(
  '[Co] Countersign Added',
  props<{ accidentNo: string; itemId: string; role: string; operator: string; opinion: string }>(),
)
export const sharesBackfilled = createAction('[Co] Shares Backfilled', props<{ accidentNo: string; operator: string }>())
export const batchSaved = createAction('[Co] Batch Saved', props<{ accidentNo: string; at: string; batch?: CoBatch }>())
export const batchSaving = createAction('[Co] Batch Saving')
export const batchSaveFailed = createAction('[Co] Batch Save Failed', props<{ accidentNo: string; message: string }>())
export const draftRestored = createAction('[Co] Draft Restored', props<{ accidentNo: string; operator: string }>())
export const clearSubmitError = createAction('[Co] Clear Submit Error')

export const coInsuranceReducer = createReducer(
  initialCoInsuranceState,
  on(loadCoBatchesSuccess, (state, { batches }) => {
    const refreshed = batches.map((batch) => refreshBatch(batch))
    return {
      ...state,
      batches: Object.fromEntries(refreshed.map((batch) => [batch.accidentNo, batch])),
      accidentNos: refreshed.map((batch) => batch.accidentNo),
      activeAccidentNo: state.activeAccidentNo || refreshed[0]?.accidentNo || '',
    }
  }),
  on(selectAccident, (state, { accidentNo }) => ({ ...state, activeAccidentNo: accidentNo, submitError: '' })),
  on(registrationSubmitted, (state, { accidentNo, itemId, policyNo, share, deductible, operator }) => {
    const target = state.batches[accidentNo]
    if (!target) return state
    const { batch } = submitRegistration(target, itemId, { policyNo, share, deductible }, operator)
    return { ...state, batches: { ...state.batches, [accidentNo]: refreshBatch(batch) } }
  }),
  on(countersignAdded, (state, { accidentNo, itemId, role, operator, opinion }) => {
    const target = state.batches[accidentNo]
    if (!target) return state
    const batch = addCountersign(target, itemId, { role, operator, opinion })
    return { ...state, batches: { ...state.batches, [accidentNo]: refreshBatch(batch) } }
  }),
  on(sharesBackfilled, (state, { accidentNo, operator }) => {
    const target = state.batches[accidentNo]
    if (!target) return state
    const { batch } = backfillShares(target, operator)
    return { ...state, batches: { ...state.batches, [accidentNo]: refreshBatch(batch) } }
  }),
  on(batchSaving, (state) => ({ ...state, saving: true, submitError: '' })),
  on(batchSaved, (state, { accidentNo, at, batch }) => {
    const saved = batch ? refreshBatch(batch) : state.batches[accidentNo]
    const batches = saved ? { ...state.batches, [saved.accidentNo]: saved } : state.batches
    return { ...state, batches, saving: false, lastSavedAt: at, submitError: '' }
  }),
  on(batchSaveFailed, (state, { accidentNo, message }) => ({ ...state, saving: false, submitError: message })),
  on(draftRestored, (state, { accidentNo, operator }) => {
    const restored = restoreDraft(accidentNo, operator)
    if (!restored) return state
    return { ...state, batches: { ...state.batches, [accidentNo]: refreshBatch(restored) }, submitError: '' }
  }),
  on(clearSubmitError, (state) => ({ ...state, submitError: '' })),
)

export const selectCoState = (state: AppState) => state.coInsurance
export const selectCoBatches = createSelector(selectCoState, (state) =>
  state.accidentNos.map((no) => state.batches[no]).filter(Boolean),
)
export const selectActiveAccidentNo = createSelector(selectCoState, (state) => state.activeAccidentNo)
export const selectActiveBatch = createSelector(
  selectCoState,
  (state) => state.batches[state.activeAccidentNo] ?? state.batches[state.accidentNos[0]],
)
export const selectSaving = createSelector(selectCoState, (state) => state.saving)
export const selectSubmitError = createSelector(selectCoState, (state) => state.submitError)
export const selectLastSavedAt = createSelector(selectCoState, (state) => state.lastSavedAt)
