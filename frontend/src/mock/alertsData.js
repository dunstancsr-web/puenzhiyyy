// Mock alerts — one of each type so every UI state is visible during validation.
// severity: critical | warning | info
// alert_type maps to filter tabs on the Alerts page.

export const mockAlerts = [
  {
    id: 1,
    sku_id: "TJ-25KG",
    sku_name: "Thai Jasmine 25KG",
    alert_type: "STOCKOUT_RISK",
    severity: "critical",
    triggered_value: 26,        // days of stock
    threshold_value: 45,        // lead time days
    message:
      "Thai Jasmine 25KG has only 26 days of available stock remaining. Supplier lead time is 45 days. A stockout is projected before replenishment can arrive.",
    recommended_action:
      "Place a replenishment order immediately. Minimum order quantity is 20 MT. Consider expediting with Supplier ABC Thailand.",
    ai_recommendation_qty: 300,
    acknowledged: false,
    triggered_at: "2026-09-06T08:00:00",
  },
  {
    id: 2,
    sku_id: "TW-25KG",
    sku_name: "Thai White Rice 25KG",
    alert_type: "REORDER",
    severity: "warning",
    triggered_value: 260,       // available stock (MT)
    threshold_value: 250,       // reorder point (MT)
    message:
      "Thai White Rice 25KG available stock (260 MT) is approaching the reorder point (250 MT). At current consumption rate, the reorder point will be breached within 7 days.",
    recommended_action:
      "Initiate procurement review. Place order within 7 days to avoid falling below safety stock.",
    ai_recommendation_qty: 250,
    acknowledged: false,
    triggered_at: "2026-09-06T08:00:00",
  },
  {
    id: 3,
    sku_id: "VF-10KG",
    sku_name: "Vietnam Fragrant 10KG",
    alert_type: "OVERSTOCK",
    severity: "warning",
    triggered_value: 620,       // physical stock (MT)
    threshold_value: 400,       // max stock (MT)
    message:
      "Vietnam Fragrant 10KG physical stock (620 MT) exceeds the maximum recommended level (400 MT) by 220 MT. A further 200 MT shipment is inbound.",
    recommended_action:
      "Suspend new purchasing immediately. Review sales strategy to accelerate consumption. Estimated excess holding cost: SGD ~$4,400/month.",
    ai_recommendation_qty: 0,
    acknowledged: false,
    triggered_at: "2026-09-06T08:00:00",
  },
  {
    id: 4,
    sku_id: "BM-5KG",
    sku_name: "Basmati Premium 5KG",
    alert_type: "SLOW_MOVING",
    severity: "warning",
    triggered_value: 292,       // days of stock
    threshold_value: 120,       // slow moving threshold (days)
    message:
      "Basmati Premium 5KG has 292 days of stock on hand. Sales velocity has been decelerating — 30-day usage (18 MT) is below the 90-day average (19.3 MT/month).",
    recommended_action:
      "Reduce next order quantity. Consider targeted promotions for price-sensitive customers or food-service channels.",
    ai_recommendation_qty: null,
    acknowledged: false,
    triggered_at: "2026-09-06T08:00:00",
  },
  {
    id: 5,
    sku_id: "JP-5KG",
    sku_name: "Japonica Short Grain 5KG",
    alert_type: "IDLE",
    severity: "critical",
    triggered_value: 104,       // days since last sale
    threshold_value: 90,        // idle threshold (days)
    message:
      "Japonica Short Grain 5KG has had no meaningful sales for 104 days. Current stock: 78 MT valued at approximately SGD $249,600.",
    recommended_action:
      "Stop replenishment immediately. Initiate inventory disposition review: evaluate discount campaign, alternative commercial channels, or CSR donation if stock remains unsellable.",
    ai_recommendation_qty: null,
    acknowledged: false,
    triggered_at: "2026-09-06T08:00:00",
  },
  {
    id: 6,
    sku_id: "JP-5KG",
    sku_name: "Japonica Short Grain 5KG",
    alert_type: "AGEING",
    severity: "warning",
    triggered_value: 189,       // inventory age (days)
    threshold_value: 180,       // ageing threshold (days)
    message:
      "Japonica Short Grain 5KG inventory has been held for 189 days (ageing status: Ageing). At current demand, this stock will not be consumed before the 270-day maximum holding limit.",
    recommended_action:
      "Escalate to QA and commercial team. Consider: price reduction, wholesale channel, or CSR evaluation before stock reaches critical age.",
    ai_recommendation_qty: null,
    acknowledged: false,
    triggered_at: "2026-09-06T08:00:00",
  },
];

// Helper: count by type (used by Alerts page summary cards)
export const getAlertCounts = () =>
  mockAlerts.reduce(
    (acc, a) => {
      if (!a.acknowledged) {
        acc[a.alert_type] = (acc[a.alert_type] || 0) + 1;
        acc.total = (acc.total || 0) + 1;
      }
      return acc;
    },
    { total: 0 }
  );
