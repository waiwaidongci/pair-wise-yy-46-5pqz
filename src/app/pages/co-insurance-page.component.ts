import { Component, OnDestroy, OnInit } from '@angular/core'
import { CommonModule, CurrencyPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSlideToggleModule } from '@angular/material/slide-toggle'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map, Observable, Subscription } from 'rxjs'
import { ClaimsService } from '../core/claims.service'
import type { CoBatch, CoComputation, CoLossItem, CoRegistration } from '../core/co-insurance.models'
import { computeBatch } from '../core/co-insurance.logic'
import {
  batchSaving,
  batchSaveFailed,
  batchSaved,
  countersignAdded,
  loadCoBatchesSuccess,
  registrationSubmitted,
  selectAccident,
  selectActiveAccidentNo,
  selectActiveBatch,
  selectCoBatches,
  selectLastSavedAt,
  selectSaving,
  selectSubmitError,
  sharesBackfilled,
  draftRestored,
  type AppState,
} from '../core/co-insurance.store'
import { draftKey, loadDraft, saveDraft } from '../core/co-insurance.logic'
import { StatusChipComponent } from '../shared/status-chip.component'

type RowDraft = { share: number; deductible: number }
type CsDraft = { role: string; opinion: string }

@Component({
  selector: 'app-co-insurance-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page" *ngIf="batch$ | async as batch">
      <div class="page-head">
        <div>
          <p class="eyebrow">CO-INSURANCE ALLOCATION / 共保分摊</p>
          <h1>
            共保分摊批次 · {{ batch.accidentNo }}
            <app-status-chip
              [label]="batch.status"
              [tone]="batch.status === '待复核' || batch.status === '待补录' ? 'warn' : batch.status === '已锁定' ? 'good' : 'default'"
            />
          </h1>
          <p class="muted">
            {{ batch.insured }} · {{ batch.lossAddress }} · 事故日 {{ batch.accidentDate }} · 实际损失
            <strong>{{ batch.actualLoss | currency:'CNY':'symbol':'1.0-0' }}</strong>
          </p>
        </div>
        <div class="actions">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="accident-select">
            <mat-label>切换事故批次</mat-label>
            <mat-select [ngModel]="activeAccidentNo$ | async" (ngModelChange)="switchAccident($event)">
              <mat-option *ngFor="let no of accidentNos$ | async" [value]="no">{{ no }}</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-slide-toggle [(ngModel)]="simulateFail" color="warn">模拟写入失败</mat-slide-toggle>
          <button mat-stroked-button (click)="restoreLocal(batch.accidentNo)">
            <mat-icon>restore</mat-icon> 恢复本地批次
          </button>
          <button mat-flat-button color="primary" [disabled]="(saving$ | async) || batch.status === '待补录'" (click)="submitBatch(batch, simulateFail)">
            <mat-icon>cloud_upload</mat-icon> 提交批次
          </button>
        </div>
      </div>

      <!-- 写入失败恢复条 -->
      <mat-card appearance="outlined" class="banner error" *ngIf="submitError$ | async as error">
        <mat-icon>error_outline</mat-icon>
        <div class="banner-body">
          <strong>写入失败：{{ error }}</strong>
          <span>本地批次已按事故号 {{ batch.accidentNo }} 保存，可恢复后重试；重试时审计按幂等键去重，不重复追加。</span>
        </div>
        <div class="banner-actions">
          <button mat-stroked-button (click)="restoreLocal(batch.accidentNo)"><mat-icon>restore</mat-icon> 恢复本地批次</button>
          <button mat-flat-button color="primary" [disabled]="saving$ | async" (click)="submitBatch(batch, false)"><mat-icon>refresh</mat-icon> 重试提交</button>
        </div>
      </mat-card>

      <!-- 旧案缺份额补录条 -->
      <mat-card appearance="outlined" class="banner warn" *ngIf="batch.status === '待补录'">
        <mat-icon>warning_amber</mat-icon>
        <div class="banner-body">
          <strong>旧案件缺少承保份额</strong>
          <span>检测到 {{ batch.items.length }} 个损失科目未登记承保份额/免赔额，需先补录首版（按保单份额 V1 起算）后才能试算提交。</span>
        </div>
        <div class="banner-actions">
          <button mat-flat-button color="primary" (click)="backfill(batch.accidentNo)"><mat-icon>playlist_add</mat-icon> 补录份额首版</button>
        </div>
      </mat-card>

      <!-- 超实际损失停算条 -->
      <mat-card appearance="outlined" class="banner stop" *ngIf="computation$ | async as computation">
        <ng-container *ngIf="computation.stopped">
          <mat-icon>block</mat-icon>
          <div class="banner-body">
            <strong>已停算并要求复核</strong>
            <span>{{ computation.stopReason }}。主管看到的赔付总额不得超过实际损失，请调整份额/免赔额或核减科目金额后重新会签。</span>
          </div>
        </ng-container>
      </mat-card>

      <div class="summary-grid" *ngIf="computation$ | async as computation">
        <mat-card appearance="outlined"><span>保单（已按保单号去重）</span><strong>{{ batch.policies.length }}</strong><small>{{ batch.mergedCount ?? 0 }} 条重复录入已合并</small></mat-card>
        <mat-card appearance="outlined"><span>损失科目</span><strong>{{ batch.items.length }}</strong><small>{{ missingCount(batch) }} 个待补份额</small></mat-card>
        <mat-card appearance="outlined"><span>分摊基数合计</span><strong>{{ computation.totalGross | currency:'CNY':'symbol':'1.0-0' }}</strong><small>Σ 科目损失 × 份额</small></mat-card>
        <mat-card appearance="outlined"><span>赔付合计（扣免赔）</span><strong [class.over]="computation.overLimit">{{ computation.totalPayable | currency:'CNY':'symbol':'1.0-0' }}</strong><small [class.over]="computation.overLimit">{{ computation.overLimit ? '超过实际损失，已停算' : '未超过实际损失' }}</small></mat-card>
      </div>

      <div class="co-grid">
        <section class="panel">
          <div class="panel-head">
            <h3>保单与承保份额</h3>
            <span class="muted">同一事故按保单号去重 · 每个科目登记份额与免赔额</span>
          </div>
          <div class="table-wrap">
            <table mat-table [dataSource]="batch.policies">
              <ng-container matColumnDef="policyNo">
                <th mat-header-cell *matHeaderCellDef>保单号</th>
                <td mat-cell *matCellDef="let policy"><strong>{{ policy.policyNo }}</strong><small>{{ policy.insurer }}</small></td>
              </ng-container>
              <ng-container matColumnDef="share">
                <th mat-header-cell *matHeaderCellDef>承保份额</th>
                <td mat-cell *matCellDef="let policy">{{ policy.share }}%</td>
              </ng-container>
              <ng-container matColumnDef="deductible">
                <th mat-header-cell *matHeaderCellDef>免赔额</th>
                <td mat-cell *matCellDef="let policy">{{ policy.deductible | currency:'CNY':'symbol':'1.0-0' }}</td>
              </ng-container>
              <ng-container matColumnDef="enteredBy">
                <th mat-header-cell *matHeaderCellDef>受理员</th>
                <td mat-cell *matCellDef="let policy">{{ policy.enteredBy }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="policyColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: policyColumns"></tr>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>本地批次恢复</h3>
            <span class="muted">写入失败按事故号恢复</span>
          </div>
          <div class="recovery-box">
            <mat-icon>cloud_sync</mat-icon>
            <div>
              <strong>草稿键 {{ draftKeyOf(batch.accidentNo) }}</strong>
              <p *ngIf="hasLocalDraft(batch.accidentNo)">本地草稿已保存，最后同步 {{ (lastSavedAt$ | async) || '—' }}；写入失败后可一键恢复再重试。</p>
              <p *ngIf="!hasLocalDraft(batch.accidentNo)">首次提交失败后将自动在此保存本地批次。</p>
            </div>
          </div>
        </section>
      </div>

      <section class="panel items-panel">
        <div class="panel-head">
          <h3>损失科目 · 份额登记 · 会签依据</h3>
          <span class="muted">先到生效，后到留冲突；份额/免赔额变更即时失效旧会签并重算</span>
        </div>
        <mat-accordion multi>
          <mat-expansion-panel *ngFor="let item of batch.items; let itemIndex = index" [expanded]="itemIndex === 0">
            <mat-expansion-panel-header>
              <mat-panel-title>
                <strong>{{ item.category }}</strong>
                <span>{{ item.description }}</span>
              </mat-panel-title>
              <mat-panel-description>
                <span class="loss-amount">{{ item.lossAmount | currency:'CNY':'symbol':'1.0-0' }}</span>
                <app-status-chip *ngIf="invalidatedCount(item) > 0" [label]="invalidatedCount(item) + ' 条会签失效'" tone="warn" />
                <app-status-chip *ngIf="item.conflicts.length > 0" [label]="item.conflicts.length + ' 条冲突'" tone="warn" />
                <app-status-chip *ngIf="item.registrations.length === 0" label="待补份额" tone="warn" />
              </mat-panel-description>
            </mat-expansion-panel-header>

            <div class="item-body">
              <div class="table-wrap">
                <table mat-table [dataSource]="item.registrations">
                  <ng-container matColumnDef="policyNo">
                    <th mat-header-cell *matHeaderCellDef>保单号</th>
                    <td mat-cell *matCellDef="let reg">
                      <strong>{{ reg.policyNo }}</strong>
                      <small *ngIf="allocationOf(batch, item, reg) as alloc">分摊基数 {{ alloc.base | currency:'CNY':'symbol':'1.0-0' }}</small>
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="share">
                    <th mat-header-cell *matHeaderCellDef>承保份额</th>
                    <td mat-cell *matCellDef="let reg">
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="inline-field">
                        <input matInput type="number" [ngModel]="rowDraft(item, reg).share" (ngModelChange)="rowDraft(item, reg).share = $event" />
                        <span matSuffix>%</span>
                      </mat-form-field>
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="deductible">
                    <th mat-header-cell *matHeaderCellDef>免赔额</th>
                    <td mat-cell *matCellDef="let reg">
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="inline-field deductible">
                        <input matInput type="number" [ngModel]="rowDraft(item, reg).deductible" (ngModelChange)="rowDraft(item, reg).deductible = $event" />
                      </mat-form-field>
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="version">
                    <th mat-header-cell *matHeaderCellDef>版本</th>
                    <td mat-cell *matCellDef="let reg">V{{ reg.version }}<small>{{ reg.lockedBy }} · {{ reg.lockedAt }}</small></td>
                  </ng-container>
                  <ng-container matColumnDef="actions">
                    <th mat-header-cell *matHeaderCellDef></th>
                    <td mat-cell *matCellDef="let reg">
                      <button mat-button color="primary" (click)="saveRegistration(batch, item, reg)">保存并重算</button>
                      <button mat-button color="warn" (click)="simulateConcurrent(batch, item, reg)">模拟并发提交（另一受理员）</button>
                    </td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="regColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: regColumns"></tr>
                </table>
              </div>
              <p class="empty-hint" *ngIf="item.registrations.length === 0">该科目尚未登记承保份额，请先使用上方「补录份额首版」。</p>

              <!-- 冲突留痕 -->
              <div class="conflicts" *ngIf="item.conflicts.length > 0">
                <h4>并发冲突（后到未生效）</h4>
                <div class="conflict" *ngFor="let conflict of item.conflicts">
                  <mat-icon>bolt</mat-icon>
                  <div>
                    <strong>{{ conflict.operator }} · {{ conflict.at }}</strong>
                    <p>{{ conflict.reason }}</p>
                    <small>尝试提交：份额 {{ conflict.attempted.share }}%、免赔 {{ conflict.attempted.deductible | currency:'CNY':'symbol':'1.0-0' }}</small>
                  </div>
                </div>
              </div>

              <!-- 会签 -->
              <div class="countersigns">
                <h4>会签依据（份额/免赔额变更后立即失效，旧意见保留并标出原依据）</h4>
                <div class="sign" *ngFor="let sign of item.countersigns" [class.invalidated]="sign.status === '已失效'">
                  <div class="sign-head">
                    <strong>{{ sign.role }}</strong>
                    <app-status-chip [label]="sign.status" [tone]="sign.status === '有效' ? 'good' : 'warn'" />
                    <span class="muted">{{ sign.operator }} · {{ sign.decidedAt }}</span>
                  </div>
                  <p class="opinion">{{ sign.opinion }}</p>
                  <div class="basis">
                    <span>会签原依据：</span>
                    <code *ngFor="let snap of sign.basis">{{ snap.policyNo }} 份额 {{ snap.share }}% / 免赔 {{ snap.deductible | currency:'CNY':'symbol':'1.0-0' }}</code>
                  </div>
                  <p class="invalidated-reason" *ngIf="sign.status === '已失效'"><mat-icon>history_toggle_off</mat-icon> {{ sign.invalidatedReason }}</p>
                </div>
                <p class="empty-hint" *ngIf="item.countersigns.length === 0">暂无会签，登记份额后可发起会签。</p>

                <div class="sign-form">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>会签角色</mat-label>
                    <mat-select [ngModel]="csDraft(item).role" (ngModelChange)="csDraft(item).role = $event">
                      <mat-option value="高级核赔员">高级核赔员</mat-option>
                      <mat-option value="理赔经理">理赔经理</mat-option>
                      <mat-option value="区域负责人">区域负责人</mat-option>
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="opinion-field">
                    <mat-label>会签意见（固化当前份额/免赔额为依据）</mat-label>
                    <input matInput [ngModel]="csDraft(item).opinion" (ngModelChange)="csDraft(item).opinion = $event" />
                  </mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!csDraft(item).opinion.trim() || item.registrations.length === 0" (click)="addCountersign(batch, item)">
                    发起会签
                  </button>
                </div>
              </div>
            </div>
          </mat-expansion-panel>
        </mat-accordion>
      </section>

      <section class="panel audit-panel">
        <div class="panel-head">
          <h3>分摊批次审计时间线</h3>
          <span class="muted">{{ batch.audit.length }} 条 · 重试按幂等键去重</span>
        </div>
        <div class="timeline">
          <article *ngFor="let event of batch.audit.slice().reverse()">
            <div class="time">{{ event.at }}</div>
            <div class="rail"><i></i><b></b></div>
            <div class="event">
              <strong>{{ event.action }}</strong>
              <p>{{ event.detail }}</p>
              <small>{{ event.operator }}<span *ngIf="event.dedupeKey"> · 幂等键 {{ event.dedupeKey }}</span></small>
            </div>
          </article>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .page-head h1 { display: flex; align-items: center; gap: 10px; }
    .page-head strong { color: #153747; }
    .accident-select { width: 220px; }
    .banner { display: flex; align-items: center; gap: 12px; padding: 14px 16px; margin-bottom: 14px; border-color: #dce3e6; }
    .banner mat-icon { font-size: 26px; width: 26px; height: 26px; }
    .banner-body { display: grid; gap: 2px; flex: 1; }
    .banner-body span { color: #69767f; font-size: 12px; }
    .banner-actions { display: flex; gap: 8px; }
    .banner.error { background: #fdf1ee; border-color: #e6b9ae; }
    .banner.error mat-icon { color: #b55a44; }
    .banner.warn { background: #fff7e8; border-color: #e6c98e; }
    .banner.warn mat-icon { color: #b07a24; }
    .banner.stop { background: #fdeeec; border-color: #d9a49b; }
    .banner.stop mat-icon { color: #b5442f; }
    .summary-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; margin-bottom: 14px; }
    .summary-grid mat-card { padding: 15px; border-color: #dce3e6; }
    .summary-grid span, .summary-grid small { display: block; color: #6e7a83; font-size: 12px; }
    .summary-grid strong { display: block; margin: 6px 0; color: #153747; font-size: 24px; }
    .summary-grid strong.over, .summary-grid small.over { color: #b5442f; }
    .co-grid { display: grid; grid-template-columns: minmax(0,1fr) 300px; gap: 14px; margin-bottom: 14px; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; min-width: 560px; }
    td small { display: block; margin-top: 3px; color: #7b8790; font-size: 10px; }
    .recovery-box { display: flex; gap: 10px; padding: 14px; }
    .recovery-box mat-icon { color: #2f7d89; }
    .recovery-box strong { font-size: 12px; }
    .recovery-box p { margin: 4px 0 0; color: #69767f; font-size: 11px; line-height: 1.5; }
    .items-panel { margin-bottom: 14px; }
    .item-body { display: grid; gap: 14px; padding-top: 10px; }
    .inline-field { width: 110px; }
    .inline-field.deductible { width: 130px; }
    .loss-amount { color: #1d6670; font-weight: 800; }
    .empty-hint { color: #8b969d; font-size: 11px; margin: 0; }
    .conflicts h4, .countersigns h4 { margin: 0 0 8px; font-size: 13px; }
    .conflict { display: flex; gap: 9px; padding: 10px; margin-bottom: 8px; background: #fff4ef; border-left: 3px solid #ce743e; border-radius: 4px; }
    .conflict mat-icon { color: #b55a2e; font-size: 18px; width: 18px; height: 18px; }
    .conflict strong { font-size: 12px; color: #984313; }
    .conflict p { margin: 4px 0; color: #6d5d55; font-size: 11px; line-height: 1.5; }
    .conflict small { color: #8b7d74; font-size: 10px; }
    .sign { padding: 12px; margin-bottom: 8px; border: 1px solid #e2e9eb; border-radius: 8px; }
    .sign.invalidated { background: #faf6f5; border-color: #e3d3cf; }
    .sign-head { display: flex; align-items: center; gap: 10px; }
    .sign-head strong { font-size: 13px; }
    .sign-head .muted { font-size: 10px; }
    .opinion { margin: 8px 0; color: #4f5d66; font-size: 12px; line-height: 1.55; }
    .basis { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11px; color: #69767f; }
    .basis code { padding: 2px 7px; background: #eef3f4; border-radius: 4px; color: #3d5a63; font-size: 10px; }
    .invalidated-reason { display: flex; align-items: center; gap: 5px; margin: 8px 0 0; color: #984313; font-size: 11px; }
    .invalidated-reason mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .sign-form { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding-top: 6px; border-top: 1px dashed #e2e9eb; }
    .sign-form mat-form-field { width: 180px; }
    .sign-form .opinion-field { flex: 1; min-width: 220px; }
    .audit-panel { margin-bottom: 14px; }
    .timeline { padding: 18px 20px; }
    .timeline article { display: grid; grid-template-columns: 130px 22px minmax(0,1fr); }
    .time { padding-top: 2px; color: #66757e; font-family: monospace; font-size: 11px; text-align: right; }
    .rail { position: relative; }
    .rail i { position: absolute; z-index: 2; top: 3px; left: 7px; width: 8px; height: 8px; border: 2px solid #fff; border-radius: 50%; background: #2c7f89; box-shadow: 0 0 0 1px #2c7f89; }
    .rail b { position: absolute; top: 11px; bottom: -2px; left: 10px; width: 1px; background: #ccd8dc; }
    .event { padding: 0 0 22px 8px; }
    .event strong { font-size: 13px; }
    .event p { margin: 6px 0; color: #56656e; font-size: 12px; line-height: 1.55; }
    .event small { color: #89949b; font-size: 10px; }
    @media (max-width: 1050px) { .co-grid { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 620px) { .summary-grid { grid-template-columns: 1fr 1fr; } }
  `],
})
export class CoInsurancePageComponent implements OnInit, OnDestroy {
  batch$: Observable<CoBatch | undefined>
  computation$: Observable<CoComputation | undefined>
  accidentNos$: Observable<string[]>
  activeAccidentNo$: Observable<string>
  saving$: Observable<boolean>
  submitError$: Observable<string>
  lastSavedAt$: Observable<string>

  policyColumns = ['policyNo', 'share', 'deductible', 'enteredBy']
  regColumns = ['policyNo', 'share', 'deductible', 'version', 'actions']
  simulateFail = false

  private rowDrafts = new Map<string, RowDraft>()
  private csDrafts = new Map<string, CsDraft>()
  private sub?: Subscription

  constructor(
    private readonly store: Store<AppState>,
    private readonly service: ClaimsService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.batch$ = this.store.select(selectActiveBatch)
    this.computation$ = this.store.select(selectActiveBatch).pipe(map((batch) => (batch ? computeBatch(batch) : undefined)))
    this.accidentNos$ = this.store.select(selectCoBatches).pipe(map((batches) => batches.map((batch) => batch.accidentNo)))
    this.activeAccidentNo$ = this.store.select(selectActiveAccidentNo)
    this.saving$ = this.store.select(selectSaving)
    this.submitError$ = this.store.select(selectSubmitError)
    this.lastSavedAt$ = this.store.select(selectLastSavedAt)
  }

  ngOnInit() {
    this.service.listCoBatches().subscribe(({ items }) => this.store.dispatch(loadCoBatchesSuccess({ batches: items })))
    // 批次任何变更都按事故号写入本地草稿，供写入失败后恢复
    this.sub = this.store.select(selectActiveBatch).subscribe((batch) => {
      if (batch) saveDraft(batch)
    })
  }

  ngOnDestroy() {
    this.sub?.unsubscribe()
  }

  draftKeyOf(accidentNo: string) {
    return draftKey(accidentNo)
  }

  hasLocalDraft(accidentNo: string) {
    return !!loadDraft(accidentNo)
  }

  rowDraft(item: CoLossItem, reg: CoRegistration): RowDraft {
    const key = `${item.id}:${reg.policyNo}`
    let draft = this.rowDrafts.get(key)
    if (!draft) {
      draft = { share: reg.share, deductible: reg.deductible }
      this.rowDrafts.set(key, draft)
    }
    return draft
  }

  csDraft(item: CoLossItem): CsDraft {
    let draft = this.csDrafts.get(item.id)
    if (!draft) {
      draft = { role: '高级核赔员', opinion: '' }
      this.csDrafts.set(item.id, draft)
    }
    return draft
  }

  allocationOf(batch: CoBatch, item: CoLossItem, reg: CoRegistration) {
    return computeBatch(batch)
      .itemAllocations.find((alloc) => alloc.itemId === item.id)
      ?.perPolicy.find((entry) => entry.policyNo === reg.policyNo)
  }

  missingCount(batch: CoBatch) {
    return batch.items.filter((item) => item.registrations.length === 0).length
  }

  invalidatedCount(item: CoLossItem) {
    return item.countersigns.filter((sign) => sign.status === '已失效').length
  }

  switchAccident(accidentNo: string) {
    this.store.dispatch(selectAccident({ accidentNo }))
  }

  saveRegistration(batch: CoBatch, item: CoLossItem, reg: CoRegistration) {
    const draft = this.rowDraft(item, reg)
    // 以登记受理员身份更新自己的份额/免赔额（版本递增）；另一受理员同时提交走「模拟并发」
    this.store.dispatch(
      registrationSubmitted({
        accidentNo: batch.accidentNo,
        itemId: item.id,
        policyNo: reg.policyNo,
        share: Number(draft.share),
        deductible: Number(draft.deductible),
        operator: reg.lockedBy,
      }),
    )
    const computation = computeBatch({
      ...batch,
      items: batch.items.map((loss) =>
        loss.id === item.id
          ? {
              ...loss,
              registrations: loss.registrations.map((entry) =>
                entry.policyNo === reg.policyNo ? { ...entry, share: Number(draft.share), deductible: Number(draft.deductible) } : entry,
              ),
            }
          : loss,
      ),
    })
    this.snackBar.open(
      computation.overLimit ? '份额/免赔额已变更：受影响会签失效重算，合计超实际损失已停算' : '份额/免赔额已变更，受影响会签已失效重算',
      '关闭',
      { duration: 2600 },
    )
  }

  // 模拟另一受理员并发提交同一科目：先到生效，后到留冲突
  simulateConcurrent(batch: CoBatch, item: CoLossItem, reg: CoRegistration) {
    this.store.dispatch(
      registrationSubmitted({
        accidentNo: batch.accidentNo,
        itemId: item.id,
        policyNo: reg.policyNo,
        share: Math.max(0, reg.share - 5),
        deductible: Math.max(0, reg.deductible - 10000),
        operator: '受理员B',
      }),
    )
    this.snackBar.open('并发提交已到达：先到受理员已锁定该科目，后到内容仅作冲突留痕', '关闭', { duration: 2600 })
  }

  addCountersign(batch: CoBatch, item: CoLossItem) {
    const draft = this.csDraft(item)
    if (!draft.opinion.trim()) return
    this.store.dispatch(
      countersignAdded({
        accidentNo: batch.accidentNo,
        itemId: item.id,
        role: draft.role,
        operator: '当前用户',
        opinion: draft.opinion.trim(),
      }),
    )
    draft.opinion = ''
    this.snackBar.open('会签已发起，当前份额/免赔额已固化为会签依据', '关闭', { duration: 2200 })
  }

  backfill(accidentNo: string) {
    this.store.dispatch(sharesBackfilled({ accidentNo, operator: '当前用户' }))
    this.snackBar.open('旧案件已补录承保份额首版 V1，可试算并提交', '关闭', { duration: 2400 })
  }

  restoreLocal(accidentNo: string) {
    this.store.dispatch(draftRestored({ accidentNo, operator: '当前用户' }))
    this.snackBar.open('已按事故号恢复本地批次', '关闭', { duration: 2000 })
  }

  submitBatch(batch: CoBatch, simulateFail: boolean) {
    this.store.dispatch(batchSaving())
    this.service.saveCoBatch(batch, simulateFail).subscribe({
      next: (saved) => {
        this.store.dispatch(batchSaved({ accidentNo: saved.accidentNo, at: new Date().toLocaleString('zh-CN'), batch: saved }))
        this.snackBar.open('共保分摊批次已提交，审计按幂等键去重未重复追加', '关闭', { duration: 2400 })
      },
      error: () => {
        this.store.dispatch(
          batchSaveFailed({ accidentNo: batch.accidentNo, message: '服务端写入失败（模拟），本地批次已保存，可恢复后重试' }),
        )
        this.snackBar.open('写入失败：本地批次已按事故号保存', '关闭', { duration: 2400 })
      },
    })
  }
}
