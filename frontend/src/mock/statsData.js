import { mockSkus } from "./riceData";
import { mockAlerts } from "./alertsData";

// Derived dashboard KPIs — computed from mock data so they stay in sync.

const activeSkus = mockSkus.filter((s) => s.health_status);

// Total inventory value = physical_stock (MT) × unit_cost_sgd
const totalInventoryValue = activeSkus.reduce(
  (sum, s) => sum + s.physical_stock * s.unit_cost_sgd,
  0
);

// Overstocked value = SKUs where physical > max_stock
const overstockedSkus = activeSkus.filter((s) => s.physical_stock > s.max_stock);
const overstockedValue = overstockedSkus.reduce(
  (sum, s) => sum + (s.physical_stock - s.max_stock) * s.unit_cost_sgd,
  0
);

// Slow + idle value
const slowIdleSkus = activeSkus.filter(
  (s) => s.movement_class === "Slow Moving" || s.movement_class === "Idle"
);
const slowIdleValue = slowIdleSkus.reduce(
  (sum, s) => sum + s.available_stock * s.unit_cost_sgd,
  0
);

// Average days of stock (exclude idle/null)
const skusWithDays = activeSkus.filter((s) => s.days_of_stock !== null);
const avgDaysOfStock = Math.round(
  skusWithDays.reduce((sum, s) => sum + s.days_of_stock, 0) / skusWithDays.length
);

// Health counts
const healthCounts = activeSkus.reduce(
  (acc, s) => { acc[s.health_status] = (acc[s.health_status] || 0) + 1; return acc; },
  { GREEN: 0, YELLOW: 0, ORANGE: 0, RED: 0 }
);

// Movement counts
const movementCounts = activeSkus.reduce(
  (acc, s) => { acc[s.movement_class] = (acc[s.movement_class] || 0) + 1; return acc; },
  { "Fast Moving": 0, Normal: 0, "Slow Moving": 0, Idle: 0 }
);

// Top 5 stockout risks (sorted by days_of_stock ascending, null = worst)
const stockoutRisks = [...activeSkus]
  .sort((a, b) => {
    if (a.days_of_stock === null) return -1;
    if (b.days_of_stock === null) return 1;
    return a.days_of_stock - b.days_of_stock;
  })
  .slice(0, 5)
  .map((s) => ({
    sku_id: s.sku_id,
    product_name: s.product_name,
    days_of_stock: s.days_of_stock,
    lead_time_days: s.lead_time_days,
    health_status: s.health_status,
  }));

// Ageing items
const ageingItems = activeSkus.filter(
  (s) => s.ageing_status === "Ageing" || s.ageing_status === "At Risk"
);

// Unacknowledged alert count
const activeAlertCount = mockAlerts.filter((a) => !a.acknowledged).length;

export const mockStats = {
  totalSkus: activeSkus.length,
  totalInventoryValue: Math.round(totalInventoryValue),
  avgDaysOfStock,
  redCount: healthCounts.RED,
  orangeCount: healthCounts.ORANGE,
  yellowCount: healthCounts.YELLOW,
  greenCount: healthCounts.GREEN,
  overstockedValue: Math.round(overstockedValue),
  slowIdleValue: Math.round(slowIdleValue),
  activeAlertCount,
  healthCounts,
  movementCounts,
  stockoutRisks,
  ageingItems,
};
