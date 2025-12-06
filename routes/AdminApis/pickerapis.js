const express = require("express");
const router = express.Router();
const pool = require("../../db"); // make sure this is your PostgreSQL pool

// POST /assign-picker
router.post("/assign-picker", async (req, res) => {
  const { orderId, employee_id } = req.body;

  // 🔹 Basic validation
  if (!orderId || !employee_id) {
    return res
      .status(400)
      .json({ error: "Order ID and Employee ID are required." });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // ✅ Check if order exists
    const orderCheck = await client.query(
      "SELECT id FROM orders WHERE id = $1",
      [orderId]
    );

    if (orderCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Order not found." });
    }

    // ✅ Check if employee exists
    const empCheck = await client.query(
      "SELECT id, full_name, role FROM employees WHERE id = $1",
      [employee_id]
    );

    if (empCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Employee not found." });
    }

    const employee = empCheck.rows[0];

    // ✅ Validate role
    if (employee.role.toLowerCase() !== "picker") {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "This employee is not a picker." });
    }

    // ✅ Assign picker to the order
    await client.query(
      `
      UPDATE orders
      SET picker_id = $1
      WHERE id = $2
      `,
      [employee_id, orderId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Picker assigned to ${employee.full_name}`,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error assigning picker:", error);
    res.status(500).json({ error: "Failed to assign picker." });
  } finally {
    client.release();
  }
});
router.get("/:pickerId", async (req, res) => {
  const { pickerId } = req.params;

  if (!pickerId) {
    return res.status(400).json({ success: false, error: "Picker ID is required." });
  }

  try {
    const result = await pool.query(
      `
      SELECT * 
      FROM orders
      WHERE picker_id = $1
      ORDER BY created_at DESC
      `,
      [pickerId]
    );

    res.json({
      success: true,
      orders: result.rows,
    });
  } catch (error) {
    console.error("Error fetching orders for picker:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.post("/mark-as-picked", async (req, res) => {
  const { orderId, picked_items, status } = req.body;

  if (!orderId || !picked_items) {
    return res.json({
      success: false,
      error: "Missing orderId or picked_items",
    });
  }

  try {
    
    await pool.query(
      `UPDATE sales_orders
       SET picked_items = $1,
           status       = $2
       WHERE id = $3`,
      [
        JSON.stringify(picked_items),   // store array as JSON
        status || "Picked",             // default status
        orderId
      ]
    );

    res.json({
      success: true,
      message: "Order marked as picked and sent to checker",
    });

  } catch (err) {
    console.log("Picker API Error:", err);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});


router.post("/update-checkerstatus", async (req, res) => {
  const { orderId, status, checked_items } = req.body;

  if (!orderId || !status) {
    return res.status(400).json({
      success: false,
      error: "OrderId and Status required",
    });
  }

  try {
    // 1) Fetch order first
    const orderRes = await pool.query(
      "SELECT * FROM sales_orders WHERE id = $1",
      [orderId]
    );

    if (orderRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    const order = orderRes.rows[0];

    // 2) Checker can only update after picker sends
    if (order.status !== "Picked") {
      return res.status(400).json({
        success: false,
        error: "Order must be in 'Picked' status before checker can update",
      });
    }

    // 3) Save checked items (optional)
    if (checked_items) {
      await pool.query(
        `UPDATE sales_orders 
         SET checked_items = $1 
         WHERE id = $2`,
        [JSON.stringify(checked_items), orderId]
      );
    }

    // 4) Update status (Checked / Rejected / Correction Needed)
    const updateRes = await pool.query(
      "UPDATE sales_orders SET status = $1 WHERE id = $2 RETURNING *",
      [status, orderId]
    );

    res.json({
      success: true,
      message: "Checker status updated successfully",
      order: updateRes.rows[0],
    });

  } catch (err) {
    console.error("Checker Update Error:", err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

router.get("/picked/all", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM sales_orders
       WHERE status IN ('Picked', 'Checked')
       ORDER BY id DESC`
    );

    res.json(result.rows);

  } catch (err) {
    console.error("Get Picked Orders Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});




module.exports = router;
