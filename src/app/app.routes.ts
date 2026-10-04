import { Routes } from '@angular/router'
import { DashboardPageComponent } from './pages/dashboard-page.component'
import { AssessmentPageComponent } from './pages/assessment-page.component'
import { ReviewPageComponent } from './pages/review-page.component'
import { CoInsurancePageComponent } from './pages/co-insurance-page.component'
import { AuditPageComponent } from './pages/audit-page.component'

export const routes: Routes = [
  { path: '', component: DashboardPageComponent, title: '案件总览' },
  { path: 'assessment', component: AssessmentPageComponent, title: '查勘定损' },
  { path: 'co-insurance', component: CoInsurancePageComponent, title: '共保分摊' },
  { path: 'review', component: ReviewPageComponent, title: '准备金审批' },
  { path: 'audit', component: AuditPageComponent, title: '审计与附件' },
  { path: '**', redirectTo: '' },
]
