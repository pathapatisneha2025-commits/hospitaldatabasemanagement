const pool = require("../db");

const syncSalesOrders = async () => {
  try {
    console.log("🔄 Sync started");

    // 1. Get last sync time
    const syncRes = await pool.query(
      "SELECT last_synced_at FROM sync_logs ORDER BY id DESC LIMIT 1"
    );

    const lastSyncedAt = syncRes.rows[0]?.last_synced_at;

    // 2. Fetch from EcoGreen API
    const response = await fetch(
      `https://hospitaldatabasemanagement.onrender.com/ecogreen/sales-orders?from=${lastSyncedAt}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer YOUR_API_KEY"
        }
      }
    );

    const orders = await response.json();

    // 3. Save to DB
    for (const data of orders || []) {
      await pool.query(
        `INSERT INTO ecogreensales_orders (
          order_id, order_no, created_at, order_type,
          invoice_id, payment_status, total_price,
          total_discount, order_for, delivered_by,
          shipping_charge, patient_name, patient_contact_no,
          patient_address, pharmacy, order_items
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (order_id) DO UPDATE SET
          payment_status = EXCLUDED.payment_status,
          total_price = EXCLUDED.total_price,
          updated_at = NOW()`,
        [
          data.order_id,
          data.order_no,
          data.created_at,
          data.order_type,
          data.invoice_id,
          data.payment_status,
          data.total_price || 0,
          data.total_discount || 0,
          data.order_for,
          data.delivered_by,
          data.shipping_charge || 0,
          data.patient_name,
          data.patient_contact_no,
          JSON.stringify(data.patient_address || null),
          JSON.stringify(data.pharmacy || null),
          JSON.stringify(data.order_items || null)
        ]
      );
    }

    // 4. Update sync time
    await pool.query(
      "INSERT INTO sync_logs (last_synced_at) VALUES (NOW())"
    );

    console.log("✅ Sync completed");

  } catch (err) {
    console.error("❌ Sync error:", err.message);
  }
};

module.exports = syncSalesOrders;