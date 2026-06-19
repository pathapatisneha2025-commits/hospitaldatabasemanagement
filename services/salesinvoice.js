const pool = require("../db");

const syncSalesInvoices = async () => {
  try {
    console.log("🔄 Sales Invoice Sync started");

    const syncRes = await pool.query(`
      SELECT last_synced_at
      FROM sync_logs_invoice
      ORDER BY id DESC
    `);

    let lastSyncedAt = syncRes.rows[0]?.last_synced_at;

    if (!lastSyncedAt) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      lastSyncedAt = new Date(
        yesterday.toLocaleString("en-US", {
          timeZone: "Asia/Kolkata",
        })
      );

      console.log("Using fallback IST:", lastSyncedAt);
    }

    const url = `https://hospitaldatabasemanagement.onrender.com/ecogreen/sales-invoices?from=${encodeURIComponent(
      lastSyncedAt.toISOString()
    )}`;

    const response = await fetch(url);
    const invoices = await response.json();

    if (!Array.isArray(invoices)) {
      console.log("Invalid response");
      return;
    }

    let latestCreatedAt = lastSyncedAt;

    for (const data of invoices) {
      await pool.query(
        `
        INSERT INTO ecogreensales_invoices (
          order_id,
          order_no,
          invoice_id,
          created_at,
          order_type,
          payment_status,
          total_price,
          total_discount,
          order_for,
          delivered_by,
          shipping_charge,
          patient_name,
          patient_contact_no,
          patient_address,
          store_id,
          order_items,
          user_email
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,
          $9,$10,$11,$12,$13,$14,$15,$16,$17
        )
        ON CONFLICT (invoice_id)
        DO UPDATE SET
          payment_status = EXCLUDED.payment_status,
          total_price = EXCLUDED.total_price,
          total_discount = EXCLUDED.total_discount,
          updated_at = NOW()
        `,
        [
          data.order_id,
          data.order_no,
          data.invoice_id,   // ✅ FIXED HERE (IMPORTANT)
          data.created_at,
          data.order_type,
          data.payment_status,
          data.total_price || 0,
          data.total_discount || 0,
          data.order_for,
          data.delivered_by,
          data.shipping_charge || 0,
          data.patient_name,
          data.patient_contact_no,
          JSON.stringify(data.patient_address || null),
          data.store_id,
          JSON.stringify(data.order_items || null),
          data.user_email,
        ]
      );

      if (
        data.created_at &&
        new Date(data.created_at) > new Date(latestCreatedAt)
      ) {
        latestCreatedAt = data.created_at;
      }
    }

    await pool.query(
      `INSERT INTO sync_logs_invoice (last_synced_at) VALUES ($1)`,
      [latestCreatedAt]
    );

    console.log("✅ Sync completed:", latestCreatedAt);

  } catch (err) {
    console.error("❌ Sync error:", err.message);
  }
};

module.exports = syncSalesInvoices;