const express = require("express");
const router = express.Router();
const pool = require("../../db");

// -------------------- CREATE Purchase Order --------------------
router.post("/add", async (req, res) => { 
  try {
    const {
      supplier,
      delivery_type,
      received_date,
      status,
      assignedto,
      receivedby,
      items // array of purchase order items
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "Purchase items are required" });
    }

    // Generate purchase_no automatically
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
    const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    const purchase_no = `PO-${dateStr}-${randomNum}`;

    // Insert into database
    const result = await pool.query(
      `INSERT INTO purchase_orders 
       (supplier, purchase_no, delivery_type, received_date, status, assignedto, receivedby, purchase_items) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        supplier,
        purchase_no,
        delivery_type,
        received_date,
        status,
        assignedto,
        receivedby,
        JSON.stringify(items) // now stored in purchase_items
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------------------- GET All Purchase Orders --------------------
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM purchase_orders ORDER BY id ASC");
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------------------- GET Purchase Order by ID --------------------
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM purchase_orders WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------------------- UPDATE Purchase Order --------------------
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      supplier,
      purchase_no,
      delivery_type,
      received_date,
      status,
      assignedto,
      receivedby,
      purchaseentry
    } = req.body;

    const result = await pool.query(
      `UPDATE purchase_orders SET 
      supplier=$1, purchase_no=$2, delivery_type=$3, received_date=$4, 
      status=$5, assignedto=$6, receivedby=$7, purchaseentry=$8 
      WHERE id=$9 RETURNING *`,
      [supplier, purchase_no, delivery_type, received_date, status, assignedto, receivedby, purchaseentry, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// -------------------- DELETE Purchase Order --------------------
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("DELETE FROM purchase_orders WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }

    res.json({ success: true, message: "Purchase order deleted successfully", data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


router.post("/receive/:poId", async (req, res) => {
  const { poId } = req.params;
  const { received_date, items } = req.body;

  try {
    // 1. Update purchase order status
    await pool.query(
      `UPDATE purchase_orders SET status='Received', received_date=$1 WHERE id=$2`,
      [received_date, poId]
    );

    // 2. Update stock for each medicine
    for (let item of items) {
      const stockToAdd = parseInt(item.stock, 10); // Ensure it's a number
      if (isNaN(stockToAdd)) continue; // Skip invalid entries

      const result = await pool.query(
        `UPDATE medicines SET stock = stock + $1 WHERE id = $2 RETURNING id, name, stock`,
        [stockToAdd, item.medicine_id]
      );

      if (result.rowCount === 0) {
        console.warn(`Medicine with id ${item.medicine_id} not found`);
      } else {
        console.log(
          `Updated medicine ${result.rows[0].name} (ID: ${result.rows[0].id}) new stock: ${result.rows[0].stock}`
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: err.message });
  }
});

// Node.js / Express example
router.get("/by-delivery-boy/:id", async (req, res) => {
  const deliveryBoyId = req.params.id;

  try {
    const result = await pool.query(
      "SELECT * FROM purchase_orders WHERE assignedto = $1",
      [deliveryBoyId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: err.message });
  }
});

router.post('/payment/collect', async (req, res) => {
  const {
    purchase_order_id,
    collected_by,
    delivery_type,
    amount_collected,
    payment_mode_collected,
    remarks
  } = req.body;

  if (!purchase_order_id || !collected_by || !amount_collected || !payment_mode_collected) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  const amountCollected = parseFloat(amount_collected);
  if (isNaN(amountCollected) || amountCollected <= 0) {
    return res.status(400).json({ success: false, message: "Invalid amount_collected" });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const poResult = await client.query(
      'SELECT * FROM purchase_orders WHERE id = $1',
      [purchase_order_id]
    );

    if (poResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: "Purchase order not found" });
    }

    const po = poResult.rows[0];

    // Calculate totalAmount from JSON if not already stored
    let totalAmount = po.total_amount;
    if (!totalAmount) {
      const items = Array.isArray(po.purchase_items) ? po.purchase_items : [];
      totalAmount = items.reduce((sum, item) => sum + (item.stock * item.unitPrice), 0);
    }

    const existingPayments = Array.isArray(po.payments) ? po.payments : [];
    const totalCollectedSoFar = existingPayments.reduce(
      (sum, p) => sum + parseFloat(p.amount_collected || 0),
      0
    );

    if (amountCollected + totalCollectedSoFar > totalAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Collected amount cannot exceed total amount" });
    }

    const paymentEntry = {
      collected_by,
      delivery_type,
      amount_collected: amountCollected,
      payment_mode_collected,
      collected_at: new Date(),
      remarks: remarks || null
    };

    const updatedPayments = [...existingPayments, paymentEntry];

    const newTotalCollected = updatedPayments.reduce((sum, p) => sum + parseFloat(p.amount_collected || 0), 0);
    let newStatus = "Partial";
    if (newTotalCollected >= totalAmount) newStatus = "Paid";
    else if (newTotalCollected === 0) newStatus = "Received";

    const updateQuery = `
      UPDATE purchase_orders
      SET payments = $1, status = $2, amount_paid = $3
      WHERE id = $4
      RETURNING *
    `;
    const updatedPoResult = await client.query(updateQuery, [
      JSON.stringify(updatedPayments),
      newStatus,
      newTotalCollected,
      purchase_order_id
    ]);

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: "Payment collected successfully",
      purchase_order: updatedPoResult.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
