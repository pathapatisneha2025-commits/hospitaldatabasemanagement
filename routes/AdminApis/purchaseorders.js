const express = require("express");
const router = express.Router();
const pool = require("../../db");

// -------------------- CREATE Purchase Order --------------------
router.post("/add", async (req, res) => {
  try {
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
      `INSERT INTO purchase_orders 
      (supplier, purchase_no, delivery_type, received_date, status, assignedto, receivedby, purchaseentry) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [supplier, purchase_no, delivery_type, received_date, status, assignedto, receivedby, purchaseentry]
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

module.exports = router;
