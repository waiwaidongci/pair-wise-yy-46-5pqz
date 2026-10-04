import { createAction, createReducer, createSelector, on, props } from '@ngrx/store'
import type { CoinsuranceBatch } from './models'

export type CoinsuranceState = {
  batches: CoinsuranceBatch[]
  selectedAccidentNo: string
  loading: boolean
}

export type CoinsuranceFeatureState = { coinsurance: CoinsuranceState }

export const initialCoinsuranceState: CoinsuranceState = {
  batches: [],
  selectedAccidentNo: '',
  loading: true,
}

export const loadCoinsuranceSuccess = createAction('[Coinsurance] Load Success', props<{ batches: CoinsuranceBatch[] }>())
export const selectCoinsuranceBatch = createAction('[Coinsurance] Select', props<{ accidentNo: string }>())
export const upsertCoinsuranceBatch = createAction('[Coinsurance] Upsert', props<{ batch: CoinsuranceBatch }>())

export const coinsuranceReducer = createReducer(
  initialCoinsuranceState,
  on(loadCoinsuranceSuccess, (state, { batches }) => ({
    ...state,
    batches,
    loading: false,
    selectedAccidentNo: state.selectedAccidentNo || batches[0]?.accidentNo || '',
  })),
  on(selectCoinsuranceBatch, (state, { accidentNo }) => ({ ...state, selectedAccidentNo: accidentNo })),
  on(upsertCoinsuranceBatch, (state, { batch }) => ({
    ...state,
    batches: state.batches.map((item) => (item.accidentNo === batch.accidentNo ? batch : item)),
  })),
)

export const selectCoinsuranceState = (state: CoinsuranceFeatureState) => state.coinsurance
export const selectAllBatches = createSelector(selectCoinsuranceState, (state) => state.batches)
export const selectSelectedAccidentNo = createSelector(selectCoinsuranceState, (state) => state.selectedAccidentNo)
export const selectSelectedBatch = createSelector(
  selectCoinsuranceState,
  (state) => state.batches.find((batch) => batch.accidentNo === state.selectedAccidentNo) ?? state.batches[0],
)
