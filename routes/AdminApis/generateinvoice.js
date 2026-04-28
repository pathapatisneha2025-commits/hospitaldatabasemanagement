const express = require("express");
const pool = require("../../db");

const router = express.Router();

function generateInvoiceNo() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");

  // timestamp + random to ensure uniqueness
  const uniquePart = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return `INV${yyyy}${mm}${dd}-${uniquePart}`;
}

/* =========================================================
    1️ GENERATE INVOICE (POST)
========================================================= */
router.post("/generate", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      employeeId,
      subadminId,
      patientName,
      patientAge,
      patientPhone,
      paymentMode,
      gender,
      address1,
      address2,
      address3,
      city,
      pin,
        finalTotal,        // 👈 ADD THIS

    } = req.body;

    if (!employeeId && !subadminId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID or Subadmin ID is required",
      });
    }

    let userName, userId;

    // Identify user
    if (employeeId) {
      const empResult = await client.query(
        "SELECT full_name FROM employees WHERE id = $1",
        [employeeId]
      );
      userName = empResult.rows[0]?.full_name || "Unknown Employee";
      userId = employeeId;
    } else if (subadminId) {
      const subResult = await client.query(
        "SELECT name FROM subadmin WHERE id = $1",
        [subadminId]
      );
      userName = subResult.rows[0]?.name || "Unknown Subadmin";
      userId = subadminId;
    }

    // START TRANSACTION
    await client.query("BEGIN");

    // Fetch cart items
    const cartResult = await client.query(
      `SELECT id, name, quantity, price 
       FROM cart 
       WHERE employeeid = $1 OR subadmin_id = $2`,
      [employeeId || null, subadminId || null]
    );

    if (cartResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "No items found in cart",
      });
    }

    const medicines = [];

    // Process stock reduction
    for (const item of cartResult.rows) {
      const medRes = await client.query(
        `SELECT id, stock_bal_qty 
         FROM stock_batches 
         WHERE item_name = $1`,
        [item.name]
      );

      if (!medRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: `Medicine not found: ${item.name}`,
        });
      }

      const medId = medRes.rows[0].id;
      const currentStock = medRes.rows[0].stock_bal_qty; // FIXED

      if (currentStock < item.quantity) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${item.name}`,
        });
      }

      // Reduce stock (FIXED TABLE)
      await client.query(
        "UPDATE stock_batches SET stock_bal_qty = stock_bal_qty - $1 WHERE id = $2",
        [item.quantity, medId]
      );

      medicines.push({
        id: medId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: parseFloat(item.price),
        total: parseFloat(item.price) * item.quantity,
      });
    }

  const totalAmount = finalTotal; 

    const invoiceNo = generateInvoiceNo();

    // INSERT INVOICE (UPDATED)
    const insertInvoice = await client.query(
      `INSERT INTO invoices 
      (
        invoice_no,
        employee_id,
        subadmin_id,
        employee_name,
        patient_name,
        patient_age,
        patient_phone,
        gender,
        address1,
        address2,
        address3,
        city,
        pin,
        medicines,
        total_amount,
        payment_mode,
        created_at
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW() AT TIME ZONE 'Asia/Kolkata')
      RETURNING *`,
      [
        invoiceNo,
        employeeId || null,
        subadminId || null,
        userName,
        patientName,
        patientAge,
        patientPhone,
        gender,
        address1,
        address2,
        address3,
        city,
        pin,
        JSON.stringify(medicines),
        totalAmount,
        paymentMode,
      ]
    );

    // CLEAR CART
    await client.query(
      "DELETE FROM cart WHERE employeeid = $1 OR subadmin_id = $2",
      [employeeId || null, subadminId || null]
    );

    // COMMIT
    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Invoice generated successfully",
      data: {
        ...insertInvoice.rows[0],
        medicines,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Invoice generation error:", error.message);

    res.status(500).json({
      success: false,
      message: "Server error",
    });
  } finally {
    client.release();
  }
});


/* =========================================================
   2️ GET ALL INVOICES
========================================================= */
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM invoices ORDER BY created_at DESC`);
    const data = result.rows.map((row) => ({
      ...row,
      medicines: typeof row.medicines === "string" ? JSON.parse(row.medicines) : (row.medicines || []),
    }));
    res.json({ success: true, count: result.rowCount, data });
  } catch (error) {
    console.error("Fetch invoices error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   3️ GET SINGLE INVOICE BY ID
========================================================= */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM invoices WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Invoice not found" });

    const invoice = result.rows[0];
    invoice.medicines = typeof invoice.medicines === "string" ? JSON.parse(invoice.medicines) : (invoice.medicines || []);

    res.json({ success: true, data: invoice });
  } catch (error) {
    console.error("Fetch invoice by ID error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* =========================================================
   4 DELETE INVOICE BY ID
========================================================= */
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`DELETE FROM invoices WHERE id = $1 RETURNING *`, [id]);

    if (result.rowCount === 0)
      return res.status(404).json({ success: false, message: "Invoice not found" });

    res.json({ success: true, message: "Invoice deleted successfully" });
  } catch (error) {
    console.error("Delete invoice by ID error:", error.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
