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

module.exports = router;
