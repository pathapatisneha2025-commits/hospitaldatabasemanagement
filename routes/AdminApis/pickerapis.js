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

router.post("/send-to-checker", async (req, res) => {
  const { orderId, picked_items, status } = req.body;

  if (!orderId || !picked_items) {
    return res.json({
      success: false,
      error: "Missing orderId or picked_items",
    });
  }

  try {
    // 👉 Combined both updates in one query using multiple fields
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


router.post("/update-status", async (req, res) => {
  const { orderId, status } = req.body;
  if (!orderId || !status)
    return res.status(400).json({ success: false, error: "OrderId and Status required" });

  try {
    const result = await pool.query(
      "UPDATE sales_orders SET status = $1 WHERE id = $2 RETURNING *",
      [status, orderId]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, error: "Order not found" });

    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});


module.exports = router;
