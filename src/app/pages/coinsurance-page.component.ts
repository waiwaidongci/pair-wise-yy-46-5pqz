import { Component, OnInit } from '@angular/core'
import { CommonModule, CurrencyPipe, PercentPipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatExpansionModule } from '@angular/material/expansion'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatIconModule } from '@angular/material/icon'
import { MatInputModule } from '@angular/material/input'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { Store } from '@ngrx/store'
import type { Observable } from 'rxjs'
import { CoinsuranceService, type ShareUpdatePayload } from '../core/coinsurance.service'
import type { ApprovalOpinion, CoinsuranceBatch, CoinsuranceBatchStatus, LossSubject, SubjectRegistration } from '../core/models'
import {
  loadCoinsuranceSuccess,
  selectAllBatches,
  selectCoinsuranceBatch,
  selectSelectedAccidentNo,
  selectSelectedBatch,
  upsertCoinsuranceBatch,
  type CoinsuranceFeatureState,
} from '../core/coinsurance.store'
import {
  apportionedFor,
  batchApportioned,
  basisLabel,
  conflictRegistrations,
  isOverrun,
  subjectApportioned,
  uniquePolicies,
  type UniquePolicy,
} from '../core/coinsurance.logic'
import { StatusChipComponent } from '../shared/status-chip.component'

type PendingShareOp = { accidentNo: string; savedAt: string; body: ShareUpdatePayload }

@Component({
  selector: 'app-coinsurance-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CurrencyPipe,
    PercentPipe,
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    StatusChipComponent,
  ],
  template: `
    <section class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">CO-INSURANCE / 共保分摊</p>
          <h1>共保分摊批次</h1>
          <p class="muted">同一事故按保单号去重，逐科目登记承保份额与免赔额；合计超限自动停算，会签依据随份额变动失效重算。</p>
        </div>
      </div>

      <div class="coins-grid">
        <aside class="panel batch-list">
          <div class="panel-head"><h3>事故批次</h3><span class="muted">{{ (batches$ | async)?.length }} 个</span></div>
          <button
            type="button"
            class="batch-item"
            *ngFor="let batch of batches$ | async"
            [class.active]="batch.accidentNo === (selectedAccidentNo$ | async)"
            (click)="selectBatch(batch.accidentNo)"
          >
            <div class="batch-top">
              <strong>{{ batch.accidentNo }}</strong>
              <app-status-chip [label]="batch.status" [tone]="statusTone(batch.status)" />
            </div>
            <p>{{ batch.title }}</p>
            <div class="batch-meta">
              <span>{{ batch.filings.length }} 笔立案 → {{ uniquePolicies(batch).length }} 张保单</span>
              <span [class.over]="isOverrun(batch)">{{ batchApportioned(batch) | currency:'CNY':'symbol':'1.0-0' }} / {{ batch.actualLoss | currency:'CNY':'symbol':'1.0-0' }}</span>
            </div>
            <mat-progress-bar mode="determinate" [color]="isOverrun(batch) ? 'warn' : 'primary'" [value]="usagePercent(batch)" />
          </button>
        </aside>

        <div class="batch-detail" *ngIf="selectedBatch$ | async as batch">
          <div class="banner local" *ngIf="pendingOp">
            <mat-icon>cloud_off</mat-icon>
            <div>
              <strong>检测到写入失败的本地批次</strong>
              <p>事故 {{ pendingOp.accidentNo }} · 暂存于 {{ pendingOp.savedAt }}，按事故号恢复后重试，审计记录不会重复追加。</p>
            </div>
            <button mat-flat-button color="primary" (click)="retryPending()">恢复并重试</button>
            <button mat-button (click)="discardPending()">丢弃</button>
          </div>

          <div class="banner danger" *ngIf="batch.status === '超限停算'">
            <mat-icon>pause_circle</mat-icon>
            <div class="banner-body">
              <strong>分摊合计超过实际损失，已停算</strong>
              <p>{{ batch.reviewNote }} 当前合计 {{ batchApportioned(batch) | currency:'CNY':'symbol':'1.0-0' }}，实际损失 {{ batch.actualLoss | currency:'CNY':'symbol':'1.0-0' }}。</p>
              <div class="review-row">
                <mat-form-field appearance="outline" subscriptSizing="dynamic">
                  <mat-label>主管复核意见</mat-label>
                  <input matInput [(ngModel)]="reviewComment" />
                </mat-form-field>
                <button mat-flat-button color="primary" [disabled]="!reviewComment.trim() || isOverrun(batch)" (click)="review(batch)">复核并解除停算</button>
              </div>
              <small *ngIf="isOverrun(batch)">请先调整份额或免赔额，使合计不超过实际损失后再复核。</small>
            </div>
          </div>

          <div class="banner info" *ngIf="batch.status === '待补录'">
            <mat-icon>history</mat-icon>
            <div>
              <strong>旧案件缺少承保份额</strong>
              <p>{{ batch.reviewNote }} 请在下方科目中补录首版份额与免赔额，补齐后自动进入分摊计算。</p>
            </div>
          </div>

          <div class="summary-grid">
            <mat-card appearance="outlined"><span>实际损失</span><strong>{{ batch.actualLoss | currency:'CNY':'symbol':'1.0-0' }}</strong><small>事故核定总额</small></mat-card>
            <mat-card appearance="outlined"><span>分摊合计</span><strong [class.over]="isOverrun(batch)">{{ batchApportioned(batch) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>全部生效登记</small></mat-card>
            <mat-card appearance="outlined"><span>差额</span><strong [class.over]="isOverrun(batch)">{{ batch.actualLoss - batchApportioned(batch) | currency:'CNY':'symbol':'1.0-0' }}</strong><small>实际损失 − 分摊合计</small></mat-card>
            <mat-card appearance="outlined"><span>有效会签</span><strong>{{ validOpinions(batch) }} / {{ batch.opinions.length }}</strong><small>失效意见保留原依据</small></mat-card>
          </div>

          <section class="panel">
            <div class="panel-head"><h3>保单去重</h3><span class="muted">同一事故按保单号合并立案</span></div>
            <table class="reg-table">
              <thead>
                <tr><th>保单号</th><th>承保人</th><th>立案号</th><th>受理员</th><th>去重结果</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let policy of uniquePolicies(batch)">
                  <td><strong>{{ policy.policyNo }}</strong></td>
                  <td>{{ policy.insurer }}</td>
                  <td>
                    <span *ngFor="let filing of policy.filings" class="claim-id">{{ filing.claimId }}</span>
                  </td>
                  <td>{{ handlersOf(policy) }}</td>
                  <td>
                    <app-status-chip *ngIf="policy.filings.length > 1; else single" [label]="'已去重 ' + policy.filings.length + ' 笔立案'" tone="warn" />
                    <ng-template #single><app-status-chip label="单笔立案" tone="good" /></ng-template>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>损失科目分摊</h3><span class="muted">先到生效 · 后到留冲突</span></div>
            <mat-accordion multi>
              <mat-expansion-panel *ngFor="let subject of batch.subjects" [expanded]="true">
                <mat-expansion-panel-header>
                  <mat-panel-title>
                    <strong>{{ subject.name }}</strong>
                    <span>实际损失 {{ subject.actualLoss | currency:'CNY':'symbol':'1.0-0' }} · 依据 V{{ subject.version }}</span>
                  </mat-panel-title>
                  <mat-panel-description>
                    <app-status-chip *ngIf="subjectApportioned(subject) > subject.actualLoss" label="本科目超限" tone="warn" />
                    <span class="subject-sum" [class.over]="subjectApportioned(subject) > subject.actualLoss">{{ subjectApportioned(subject) | currency:'CNY':'symbol':'1.0-0' }}</span>
                  </mat-panel-description>
                </mat-expansion-panel-header>

                <table class="reg-table">
                  <thead>
                    <tr><th>保单 / 承保人</th><th>承保份额</th><th>免赔额</th><th>分摊额</th><th>状态</th><th>提交</th><th></th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let reg of subject.registrations" [class.conflict]="reg.status === '冲突'">
                      <td>
                        <strong>{{ reg.policyNo }}</strong>
                        <small>{{ reg.insurer }}</small>
                      </td>
                      <td>
                        <ng-container *ngIf="reg.share != null; else missingShare">{{ reg.share | percent:'1.0-1' }}</ng-container>
                        <ng-template #missingShare><span class="missing">待补首版</span></ng-template>
                      </td>
                      <td>
                        <ng-container *ngIf="reg.deductible != null; else missingDeductible">{{ reg.deductible | currency:'CNY':'symbol':'1.0-0' }}</ng-container>
                        <ng-template #missingDeductible><span class="missing">待补首版</span></ng-template>
                      </td>
                      <td>
                        <ng-container *ngIf="reg.status === '生效'; else conflictAmount">{{ apportionedFor(subject, reg) | currency:'CNY':'symbol':'1.0-0' }}</ng-container>
                        <ng-template #conflictAmount><span class="missing">不参与分摊</span></ng-template>
                      </td>
                      <td><app-status-chip [label]="reg.status" [tone]="reg.status === '生效' ? 'good' : 'warn'" /></td>
                      <td><small>{{ reg.submittedBy }} · {{ reg.submittedAt }}</small></td>
                      <td class="row-actions">
                        <button *ngIf="reg.status === '生效' && reg.share == null" mat-stroked-button color="primary" (click)="startBackfill(subject, reg)">补录首版</button>
                        <button *ngIf="reg.status === '生效' && reg.share != null" mat-stroked-button color="primary" (click)="startEdit(subject, reg)">调整份额/免赔</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p class="conflict-note" *ngIf="conflictRegistrations(subject).length > 0">
                  <mat-icon>content_copy</mat-icon>
                  {{ conflictRegistrations(subject).length }} 条后到提交保留为冲突：同一科目同一保单先到生效，后到留冲突，不计入分摊。
                </p>

                <div class="inline-form" *ngIf="editingSubjectKey === subject.key">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>承保份额（%）</mat-label>
                    <input matInput type="number" min="1" max="100" [(ngModel)]="editSharePct" />
                  </mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>免赔额</mat-label>
                    <input matInput type="number" min="0" [(ngModel)]="editDeductible" />
                  </mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
                    <mat-label>调整理由（必填）</mat-label>
                    <input matInput [(ngModel)]="editReason" />
                  </mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="!editReason.trim() || editSharePct <= 0" (click)="submitShareChange(batch, subject)">提交调整</button>
                  <button mat-button (click)="cancelEdit()">取消</button>
                  <small class="form-hint">提交后本科目有效会签立即失效重算，旧意见保留并标出原依据。</small>
                </div>

                <div class="inline-form" *ngIf="backfillingSubjectKey === subject.key">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>承保份额（%）</mat-label>
                    <input matInput type="number" min="1" max="100" [(ngModel)]="backfillSharePct" />
                  </mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>免赔额</mat-label>
                    <input matInput type="number" min="0" [(ngModel)]="backfillDeductible" />
                  </mat-form-field>
                  <button mat-flat-button color="primary" [disabled]="backfillSharePct <= 0" (click)="submitBackfill(batch, subject)">补录首版</button>
                  <button mat-button (click)="cancelBackfill()">取消</button>
                  <small class="form-hint">旧案件缺少承保份额，补录后生成 V1 版本并进入分摊计算。</small>
                </div>

                <div class="inline-form new-reg">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>登记保单</mat-label>
                    <mat-select [(ngModel)]="regForm(subject.key).policyNo">
                      <mat-option *ngFor="let policy of uniquePolicies(batch)" [value]="policy.policyNo">{{ policy.policyNo }} · {{ policy.insurer }}</mat-option>
                    </mat-select>
                  </mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>承保份额（%）</mat-label>
                    <input matInput type="number" min="1" max="100" [(ngModel)]="regForm(subject.key).sharePct" />
                  </mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>免赔额</mat-label>
                    <input matInput type="number" min="0" [(ngModel)]="regForm(subject.key).deductible" />
                  </mat-form-field>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>提交人</mat-label>
                    <mat-select [(ngModel)]="regForm(subject.key).submitter">
                      <mat-option value="当前用户">当前用户</mat-option>
                      <mat-option value="同事·周岩">同事·周岩</mat-option>
                      <mat-option value="同事·林澈">同事·林澈</mat-option>
                    </mat-select>
                  </mat-form-field>
                  <button mat-stroked-button color="primary" [disabled]="!regForm(subject.key).policyNo || regForm(subject.key).sharePct <= 0" (click)="submitRegistration(batch, subject)">
                    登记科目
                  </button>
                  <small class="form-hint">模拟两人同时提交同一科目：先到生效，后到留冲突。</small>
                </div>

                <div class="opinions">
                  <h4>会签意见 <span class="muted">当前依据 V{{ subject.version }}：{{ basisLabel(subject) }}</span></h4>
                  <div class="opinion" *ngFor="let opinion of opinionsFor(batch, subject.key)" [class.invalid]="opinion.status === '已失效'">
                    <div class="op-head">
                      <strong>{{ opinion.role }}</strong>
                      <app-status-chip [label]="opinion.result" [tone]="opinion.result === '同意' ? 'good' : 'warn'" />
                      <app-status-chip [label]="opinion.status" [tone]="opinion.status === '有效' ? 'good' : 'default'" />
                    </div>
                    <p>{{ opinion.comment }}</p>
                    <small>{{ opinion.operator }} · {{ opinion.createdAt }}</small>
                    <small [class.stale]="opinion.status === '已失效'">
                      {{ opinion.status === '已失效' ? '原依据' : '依据' }} V{{ opinion.basisVersion }}：{{ opinion.basisLabel }}
                      <span *ngIf="opinion.invalidatedAt"> · 失效于 {{ opinion.invalidatedAt }}</span>
                    </small>
                  </div>
                  <small *ngIf="opinionsFor(batch, subject.key).length === 0" class="muted">暂无会签意见</small>

                  <div class="inline-form opinion-form" *ngIf="batch.status === '计算中'">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>会签角色</mat-label>
                      <mat-select [(ngModel)]="opinionForm(subject.key).role">
                        <mat-option value="高级核赔员">高级核赔员</mat-option>
                        <mat-option value="理赔经理">理赔经理</mat-option>
                        <mat-option value="区域负责人">区域负责人</mat-option>
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>结论</mat-label>
                      <mat-select [(ngModel)]="opinionForm(subject.key).result">
                        <mat-option value="同意">同意</mat-option>
                        <mat-option value="退回">退回</mat-option>
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="grow">
                      <mat-label>会签意见</mat-label>
                      <input matInput [(ngModel)]="opinionForm(subject.key).comment" />
                    </mat-form-field>
                    <button mat-flat-button color="primary" [disabled]="!opinionForm(subject.key).comment.trim()" (click)="submitOpinion(batch, subject)">提交会签</button>
                  </div>
                  <p class="blocked-hint" *ngIf="batch.status === '超限停算'"><mat-icon>pause_circle</mat-icon> 已停算：须主管复核解除后才能继续会签。</p>
                  <p class="blocked-hint" *ngIf="batch.status === '待补录'"><mat-icon>history</mat-icon> 旧案件缺少承保份额，补录首版后开放会签。</p>
                </div>
              </mat-expansion-panel>
            </mat-accordion>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>分摊审计</h3><span class="muted">{{ batch.audit.length }} 条 · 重试不重复追加</span></div>
            <div class="timeline">
              <article *ngFor="let event of batch.audit.slice().reverse(); let first = first">
                <div class="time">{{ event.at }}</div>
                <div class="rail"><i></i><b *ngIf="!first"></b></div>
                <div class="event">
                  <strong>{{ event.action }}</strong>
                  <p>{{ event.detail }}</p>
                  <small>{{ event.operator }} · 记录编号 {{ event.id }}</small>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .coins-grid { display: grid; grid-template-columns: 320px minmax(0,1fr); gap: 14px; align-items: start; }
    .batch-list { padding-bottom: 10px; }
    .batch-item { display: block; width: calc(100% - 20px); margin: 10px; padding: 12px; border: 1px solid #e2e8ea; border-radius: 8px; background: #f8fafb; text-align: left; cursor: pointer; font: inherit; }
    .batch-item.active { border-color: #2f8191; background: #eef6f7; box-shadow: inset 3px 0 #2f8191; }
    .batch-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .batch-item p { margin: 7px 0; color: #54636c; font-size: 12px; }
    .batch-meta { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 8px; color: #7b878f; font-size: 11px; }
    .over { color: #b95c2c !important; font-weight: 800; }
    .batch-detail { display: grid; gap: 14px; min-width: 0; }
    .banner { display: flex; gap: 10px; align-items: flex-start; padding: 13px 15px; border-radius: 9px; border: 1px solid; }
    .banner mat-icon { margin-top: 2px; }
    .banner strong { font-size: 13px; }
    .banner p { margin: 5px 0 0; font-size: 12px; line-height: 1.55; }
    .banner > div { flex: 1; min-width: 0; }
    .banner.local { color: #5b4a1e; background: #fff8e6; border-color: #ecd9a0; }
    .banner.danger { color: #8a3b1d; background: #fff0e8; border-color: #f0c3a8; }
    .banner.info { color: #1f5f6c; background: #eaf5f6; border-color: #bcdde2; }
    .banner-body .review-row { display: flex; gap: 10px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
    .banner-body .review-row mat-form-field { flex: 1; min-width: 240px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; }
    .summary-grid mat-card { padding: 15px; border-color: #dce3e6; }
    .summary-grid span, .summary-grid small { display: block; color: #6e7a83; font-size: 12px; }
    .summary-grid strong { display: block; margin: 6px 0; color: #153747; font-size: 22px; }
    .reg-table { width: 100%; border-collapse: collapse; }
    .reg-table th, .reg-table td { padding: 10px 14px; border-bottom: 1px solid #edf0f2; text-align: left; font-size: 12px; vertical-align: middle; }
    .reg-table th { color: #6d7982; font-size: 11px; font-weight: 700; background: #f7f9fa; }
    .reg-table td strong, .reg-table td small { display: block; }
    .reg-table td small { margin-top: 3px; color: #7b878f; }
    .reg-table tr.conflict td { background: #fff6ef; color: #8a5a34; }
    .claim-id { display: inline-block; margin: 2px 6px 2px 0; padding: 3px 7px; border-radius: 5px; background: #eef2f3; font-size: 11px; }
    .missing { color: #b95c2c; font-weight: 700; }
    .row-actions { white-space: nowrap; }
    .subject-sum { color: #1d6670; font-weight: 800; }
    mat-panel-title { display: flex; flex-direction: column; gap: 4px; }
    mat-panel-title span { color: #7a858c; font-size: 11px; }
    mat-panel-description { justify-content: flex-end; gap: 12px; }
    .conflict-note { display: flex; align-items: center; gap: 6px; margin: 10px 14px 0; padding: 9px 11px; border-left: 3px solid #ce743e; background: #fff3e8; color: #763f20; font-size: 11px; }
    .conflict-note mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .inline-form { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 12px 14px 0; padding: 12px; background: #f4f7f8; border-left: 3px solid #277b89; }
    .inline-form mat-form-field { width: 170px; }
    .inline-form .grow { flex: 1; min-width: 220px; }
    .inline-form .form-hint { flex-basis: 100%; color: #7d8991; font-size: 11px; }
    .inline-form.new-reg { border-left-color: #8a9aa3; }
    .opinions { margin: 14px; padding-top: 12px; border-top: 1px dashed #dfe6e8; }
    .opinions h4 { display: flex; justify-content: space-between; gap: 10px; margin: 0 0 10px; font-size: 13px; flex-wrap: wrap; }
    .opinion { padding: 10px 12px; margin-bottom: 8px; border: 1px solid #e4eaec; border-radius: 8px; background: #fbfcfc; }
    .opinion.invalid { background: #f4f4f2; color: #7a838a; }
    .opinion .op-head { display: flex; align-items: center; gap: 8px; }
    .opinion p { margin: 7px 0; font-size: 12px; color: #55646d; }
    .opinion small { display: block; margin-top: 3px; color: #89949b; font-size: 10px; }
    .opinion small.stale { color: #a06a3a; text-decoration: line-through; }
    .opinion-form { margin: 10px 0 0; }
    .blocked-hint { display: flex; align-items: center; gap: 6px; margin: 10px 0 0; color: #8a5a34; font-size: 12px; }
    .blocked-hint mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .timeline { padding: 18px 20px; }
    .timeline article { display: grid; grid-template-columns: 110px 22px minmax(0,1fr); }
    .time { padding-top: 2px; color: #66757e; font-family: monospace; font-size: 11px; text-align: right; }
    .rail { position: relative; }
    .rail i { position: absolute; z-index: 2; top: 3px; left: 7px; width: 8px; height: 8px; border: 2px solid #fff; border-radius: 50%; background: #2c7f89; box-shadow: 0 0 0 1px #2c7f89; }
    .rail b { position: absolute; top: 11px; bottom: -2px; left: 10px; width: 1px; background: #ccd8dc; }
    .event { padding: 0 0 22px 8px; }
    .event strong { font-size: 13px; }
    .event p { margin: 6px 0; color: #56656e; font-size: 12px; line-height: 1.55; }
    .event small { color: #89949b; font-size: 10px; }
    @media (max-width: 1050px) { .coins-grid { grid-template-columns: 1fr; } .summary-grid { grid-template-columns: repeat(2,1fr); } }
    @media (max-width: 620px) { .summary-grid { grid-template-columns: 1fr 1fr; } }
  `],
})
export class CoinsurancePageComponent implements OnInit {
  batches$: Observable<CoinsuranceBatch[]>
  selectedBatch$: Observable<CoinsuranceBatch | undefined>
  selectedAccidentNo$: Observable<string>

  readonly uniquePolicies = uniquePolicies
  readonly conflictRegistrations = conflictRegistrations
  readonly apportionedFor = apportionedFor
  readonly subjectApportioned = subjectApportioned
  readonly batchApportioned = batchApportioned
  readonly basisLabel = basisLabel
  readonly isOverrun = isOverrun

  editingSubjectKey = ''
  editingPolicyNo = ''
  editSharePct = 0
  editDeductible = 0
  editReason = ''

  backfillingSubjectKey = ''
  backfillingPolicyNo = ''
  backfillSharePct = 0
  backfillDeductible = 0

  regDrafts: Record<string, { policyNo: string; sharePct: number; deductible: number; submitter: string }> = {}
  opinionDrafts: Record<string, { role: string; result: string; comment: string }> = {}
  reviewComment = ''
  pendingOp: PendingShareOp | null = null

  private formsAccidentNo = ''

  constructor(
    private readonly store: Store<CoinsuranceFeatureState>,
    private readonly service: CoinsuranceService,
    private readonly snackBar: MatSnackBar,
  ) {
    this.batches$ = this.store.select(selectAllBatches)
    this.selectedBatch$ = this.store.select(selectSelectedBatch)
    this.selectedAccidentNo$ = this.store.select(selectSelectedAccidentNo)
  }

  ngOnInit() {
    this.service.listBatches().subscribe((batches) => this.store.dispatch(loadCoinsuranceSuccess({ batches })))
    this.selectedBatch$.subscribe((batch) => {
      if (!batch) return
      if (batch.accidentNo !== this.formsAccidentNo) this.resetForms(batch.accidentNo)
      this.loadPending(batch.accidentNo)
    })
  }

  regForm(subjectKey: string) {
    return (this.regDrafts[subjectKey] ??= { policyNo: '', sharePct: 0, deductible: 0, submitter: '当前用户' })
  }

  opinionForm(subjectKey: string) {
    return (this.opinionDrafts[subjectKey] ??= { role: '高级核赔员', result: '同意', comment: '' })
  }

  statusTone(status: CoinsuranceBatchStatus): 'default' | 'warn' | 'good' {
    if (status === '超限停算') return 'warn'
    if (status === '计算中') return 'good'
    return 'default'
  }

  usagePercent(batch: CoinsuranceBatch) {
    return Math.min(100, Math.round((batchApportioned(batch) / batch.actualLoss) * 100))
  }

  validOpinions(batch: CoinsuranceBatch) {
    return batch.opinions.filter((opinion) => opinion.status === '有效').length
  }

  handlersOf(policy: UniquePolicy) {
    return policy.filings.map((filing) => filing.handler).join('、')
  }

  opinionsFor(batch: CoinsuranceBatch, subjectKey: string): ApprovalOpinion[] {
    return batch.opinions.filter((opinion) => opinion.subjectKey === subjectKey)
  }

  selectBatch(accidentNo: string) {
    this.store.dispatch(selectCoinsuranceBatch({ accidentNo }))
  }

  startEdit(subject: LossSubject, reg: SubjectRegistration) {
    this.cancelBackfill()
    this.editingSubjectKey = subject.key
    this.editingPolicyNo = reg.policyNo
    this.editSharePct = Math.round((reg.share ?? 0) * 100)
    this.editDeductible = reg.deductible ?? 0
    this.editReason = ''
  }

  cancelEdit() {
    this.editingSubjectKey = ''
    this.editingPolicyNo = ''
  }

  startBackfill(subject: LossSubject, reg: SubjectRegistration) {
    this.cancelEdit()
    this.backfillingSubjectKey = subject.key
    this.backfillingPolicyNo = reg.policyNo
    this.backfillSharePct = 0
    this.backfillDeductible = 0
  }

  cancelBackfill() {
    this.backfillingSubjectKey = ''
    this.backfillingPolicyNo = ''
  }

  submitShareChange(batch: CoinsuranceBatch, subject: LossSubject) {
    if (!this.editReason.trim() || this.editSharePct <= 0) return
    const body: ShareUpdatePayload = {
      subjectKey: subject.key,
      policyNo: this.editingPolicyNo,
      share: this.editSharePct / 100,
      deductible: Number(this.editDeductible),
      reason: this.editReason.trim(),
      operator: '当前用户',
      auditId: `AUD-${batch.accidentNo}-${Date.now()}`,
    }
    this.service.updateShare(batch.accidentNo, body).subscribe({
      next: (updated) => {
        this.store.dispatch(upsertCoinsuranceBatch({ batch: updated }))
        this.cancelEdit()
        this.snack('份额已调整，受影响会签已失效重算，旧意见保留原依据')
      },
      error: (error) => {
        if (error?.status !== 500) {
          this.snack(error?.error?.message ?? '份额调整被拒绝')
          return
        }
        // 写入结果未知：按事故号把本地批次操作暂存，等待恢复重试
        const pending: PendingShareOp = { accidentNo: batch.accidentNo, savedAt: new Date().toLocaleString('zh-CN'), body }
        localStorage.setItem(this.pendingKey(batch.accidentNo), JSON.stringify(pending))
        this.pendingOp = pending
        this.snack('写入失败：已按事故号保存本地批次，可恢复重试')
      },
    })
  }

  retryPending() {
    const pending = this.pendingOp
    if (!pending) return
    this.service.updateShare(pending.accidentNo, pending.body).subscribe({
      next: (updated) => {
        this.store.dispatch(upsertCoinsuranceBatch({ batch: updated }))
        localStorage.removeItem(this.pendingKey(pending.accidentNo))
        this.pendingOp = null
        this.cancelEdit()
        this.snack('重试成功：本地批次已写回，审计记录未重复追加')
      },
      error: () => this.snack('重试仍失败，本地批次继续保留'),
    })
  }

  discardPending() {
    if (this.pendingOp) localStorage.removeItem(this.pendingKey(this.pendingOp.accidentNo))
    this.pendingOp = null
  }

  submitRegistration(batch: CoinsuranceBatch, subject: LossSubject) {
    const draft = this.regForm(subject.key)
    if (!draft.policyNo || draft.sharePct <= 0) return
    const insurer = uniquePolicies(batch).find((policy) => policy.policyNo === draft.policyNo)?.insurer ?? ''
    this.service
      .registerSubject(batch.accidentNo, {
        subjectKey: subject.key,
        policyNo: draft.policyNo,
        insurer,
        share: draft.sharePct / 100,
        deductible: Number(draft.deductible),
        submittedBy: draft.submitter,
        auditId: `AUD-${batch.accidentNo}-${Date.now()}`,
      })
      .subscribe((updated) => {
        this.store.dispatch(upsertCoinsuranceBatch({ batch: updated }))
        const registration = updated.subjects.find((item) => item.key === subject.key)?.registrations.at(-1)
        if (registration?.status === '冲突') this.snack('后到提交已保留为冲突：同一科目先到生效，后到留冲突')
        else this.snack('科目登记已生效并纳入分摊')
        this.regDrafts[subject.key] = { policyNo: '', sharePct: 0, deductible: 0, submitter: draft.submitter }
      })
  }

  submitOpinion(batch: CoinsuranceBatch, subject: LossSubject) {
    const draft = this.opinionForm(subject.key)
    if (!draft.comment.trim()) return
    this.service
      .addOpinion(batch.accidentNo, {
        subjectKey: subject.key,
        role: draft.role,
        result: draft.result,
        comment: draft.comment.trim(),
        operator: '当前用户',
        auditId: `AUD-${batch.accidentNo}-${Date.now()}`,
      })
      .subscribe({
        next: (updated) => {
          this.store.dispatch(upsertCoinsuranceBatch({ batch: updated }))
          const version = updated.subjects.find((item) => item.key === subject.key)?.version ?? subject.version
          this.snack(`会签意见已记录，依据版本 V${version}`)
          this.opinionDrafts[subject.key] = { role: draft.role, result: draft.result, comment: '' }
        },
        error: (error) => this.snack(error.error?.message ?? '会签被拒绝'),
      })
  }

  submitBackfill(batch: CoinsuranceBatch, subject: LossSubject) {
    if (this.backfillSharePct <= 0) return
    this.service
      .backfillShare(batch.accidentNo, {
        subjectKey: subject.key,
        policyNo: this.backfillingPolicyNo,
        share: this.backfillSharePct / 100,
        deductible: Number(this.backfillDeductible),
        operator: '当前用户',
        auditId: `AUD-${batch.accidentNo}-${Date.now()}`,
      })
      .subscribe((updated) => {
        this.store.dispatch(upsertCoinsuranceBatch({ batch: updated }))
        this.cancelBackfill()
        this.snack(updated.status === '待补录' ? '首版份额已补录，仍有科目待补' : '首版份额已补录，批次进入分摊计算')
      })
  }

  review(batch: CoinsuranceBatch) {
    if (!this.reviewComment.trim()) return
    this.service.review(batch.accidentNo, { comment: this.reviewComment.trim(), operator: '当前用户', auditId: `AUD-${batch.accidentNo}-${Date.now()}` }).subscribe({
      next: (updated) => {
        this.store.dispatch(upsertCoinsuranceBatch({ batch: updated }))
        this.reviewComment = ''
        this.snack('主管复核完成，已解除停算')
      },
      error: (error) => this.snack(error.error?.message ?? '复核被拒绝'),
    })
  }

  private resetForms(accidentNo: string) {
    this.formsAccidentNo = accidentNo
    this.regDrafts = {}
    this.opinionDrafts = {}
    this.reviewComment = ''
    this.cancelEdit()
    this.cancelBackfill()
  }

  private loadPending(accidentNo: string) {
    const raw = localStorage.getItem(this.pendingKey(accidentNo))
    this.pendingOp = raw ? (JSON.parse(raw) as PendingShareOp) : null
  }

  private pendingKey(accidentNo: string) {
    return `coinsurance-pending-${accidentNo}`
  }

  private snack(message: string) {
    this.snackBar.open(message, '关闭', { duration: 2400 })
  }
}
