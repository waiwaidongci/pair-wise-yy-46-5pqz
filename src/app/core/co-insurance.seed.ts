import type { CoBatch } from './co-insurance.models'
import { audit } from './co-insurance.logic'

// 共保分摊批次种子数据：
// ACC-2026-0908 同一场仓库火灾落在两张商业财产险保单上（其中一张被两位受理员重复录入）
// ACC-2025-1103 旧案件，损失科目缺少承保份额，需先补首版

export const seedCoBatches: CoBatch[] = [
  {
    accidentNo: 'ACC-2026-0908',
    insured: '上海澄湾食品有限公司',
    lossAddress: '上海市嘉定区兴顺路 88 号 3 号厂房',
    accidentDate: '2026-09-08',
    actualLoss: 1400000,
    status: '待复核',
    policies: [
      // 同一张保单被两位受理员各自录入，受理时按保单号去重
      { policyNo: 'PICC-PROP-882019', insurer: '人保财险', share: 60, deductible: 50000, enteredBy: '陆嘉' },
      { policyNo: 'PICC-PROP-882019', insurer: '人保财险', share: 60, deductible: 50000, enteredBy: '陈立' },
      { policyNo: 'CPIC-PROP-224108', insurer: '太保财险', share: 40, deductible: 30000, enteredBy: '林澈' },
    ],
    items: [
      {
        id: 'LI-01',
        category: '房屋建筑',
        description: '冷库东侧墙体及屋面钢结构',
        lossAmount: 742000,
        registrations: [
          { policyNo: 'PICC-PROP-882019', share: 60, deductible: 50000, version: 1, lockedBy: '陆嘉', lockedAt: '2026-09-12 10:20' },
          { policyNo: 'CPIC-PROP-224108', share: 40, deductible: 30000, version: 1, lockedBy: '林澈', lockedAt: '2026-09-12 10:25' },
        ],
        countersigns: [
          {
            id: 'CS-01',
            role: '高级核赔员',
            operator: '周岩',
            opinion: '房屋建筑报价依据充分，按 60%/40% 份额分摊，免赔按保单约定。',
            decidedAt: '2026-09-19 10:30',
            status: '有效',
            basis: [
              { policyNo: 'PICC-PROP-882019', share: 60, deductible: 50000 },
              { policyNo: 'CPIC-PROP-224108', share: 40, deductible: 30000 },
            ],
          },
        ],
        conflicts: [
          {
            id: 'CF-01',
            at: '2026-09-12 10:26',
            operator: '陈立',
            policyNo: 'PICC-PROP-882019',
            attempted: { share: 55, deductible: 40000 },
            reason: '并发提交：科目 房屋建筑（PICC-PROP-882019）已由陆嘉先行登记，按先到生效处理，后到内容仅作冲突留痕',
          },
        ],
      },
      {
        id: 'LI-02',
        category: '机器设备',
        description: '速冻隧道 2 号线主电机及控制柜',
        lossAmount: 520000,
        registrations: [
          { policyNo: 'PICC-PROP-882019', share: 60, deductible: 50000, version: 1, lockedBy: '陆嘉', lockedAt: '2026-09-12 10:20' },
          { policyNo: 'CPIC-PROP-224108', share: 40, deductible: 30000, version: 1, lockedBy: '林澈', lockedAt: '2026-09-12 10:25' },
        ],
        countersigns: [],
        conflicts: [],
      },
      {
        id: 'LI-03',
        category: '存货',
        description: '断电解冻变质成品冷冻食品',
        lossAmount: 316000,
        registrations: [
          { policyNo: 'PICC-PROP-882019', share: 60, deductible: 50000, version: 1, lockedBy: '陆嘉', lockedAt: '2026-09-12 10:20' },
          { policyNo: 'CPIC-PROP-224108', share: 40, deductible: 30000, version: 1, lockedBy: '林澈', lockedAt: '2026-09-12 10:25' },
        ],
        countersigns: [],
        conflicts: [],
      },
    ],
    audit: [
      audit({ at: '2026-09-08 21:32', operator: '报案中心', action: '案件受理', detail: '仓库火灾报案，两张商业财产险保单分别立案。', dedupeKey: 'seed-intake-acc1' }),
      audit({ at: '2026-09-12 10:20', operator: '陆嘉', action: '承保份额登记', detail: '科目 房屋建筑（PICC-PROP-882019）按份额 60%、免赔 50,000 元完成首版登记', dedupeKey: 'seed-reg-li01-picc' }),
      audit({ at: '2026-09-12 10:25', operator: '林澈', action: '承保份额登记', detail: '科目 房屋建筑（CPIC-PROP-224108）按份额 40%、免赔 30,000 元完成首版登记', dedupeKey: 'seed-reg-li01-cpic' }),
      audit({ at: '2026-09-12 10:26', operator: '陈立', action: '并发冲突', detail: '科目 房屋建筑（PICC-PROP-882019）份额 55%、免赔 40,000 元未生效，先到受理员陆嘉已锁定该科目', dedupeKey: 'seed-conflict-li01' }),
      audit({ at: '2026-09-19 10:30', operator: '周岩', action: '会签依据确认', detail: '科目 房屋建筑 按当前份额/免赔额完成会签：房屋建筑报价依据充分，按 60%/40% 份额分摊，免赔按保单约定。', dedupeKey: 'seed-cs-li01' }),
    ],
  },
  {
    accidentNo: 'ACC-2025-1103',
    insured: '宁波海岬仓储有限公司',
    lossAddress: '宁波北仑区海盛路 14 号',
    accidentDate: '2025-11-03',
    actualLoss: 860000,
    status: '待补录',
    policies: [
      { policyNo: 'PICC-PROP-882019', insurer: '人保财险', share: 70, deductible: 50000, enteredBy: '林澈' },
      { policyNo: 'CPIC-PROP-224108', insurer: '太保财险', share: 30, deductible: 20000, enteredBy: '林澈' },
    ],
    items: [
      {
        id: 'LI-11',
        category: '房屋建筑',
        description: '仓储库房屋面和排水天沟',
        lossAmount: 420000,
        registrations: [], // 旧案件缺少承保份额
        countersigns: [],
        conflicts: [],
      },
      {
        id: 'LI-12',
        category: '存货',
        description: '进口纸浆受潮降级处理',
        lossAmount: 440000,
        registrations: [],
        countersigns: [],
        conflicts: [],
      },
    ],
    audit: [
      audit({ at: '2025-11-03 06:18', operator: '报案中心', action: '案件受理', detail: '台风损失报案，两张保单共保。', dedupeKey: 'seed-intake-acc2' }),
      audit({ at: '2025-11-04 09:15', operator: '林澈', action: '现场查勘', detail: '上传屋面和库区照片，损失科目已录入。', dedupeKey: 'seed-survey-acc2' }),
    ],
  },
]
