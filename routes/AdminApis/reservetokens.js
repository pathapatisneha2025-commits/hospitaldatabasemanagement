const express = require("express");
const pool = require("../../db");

const router = express.Router();

// ➕ ADD RULE
router.post("/add", async (req, res) => {
  try {
    const { doctor_id, reserved_count, date } = req.body;

    // 1. Get doctor info from doctor_id
    const doctorRes = await pool.query(
      `SELECT name, email FROM doctors WHERE id = $1`,
      [doctor_id]
    );

    if (doctorRes.rows.length === 0) {
      return res.status(400).json({ error: "Doctor not found" });
    }

    const doctor_name = doctorRes.rows[0].name;
    const doctor_email = doctorRes.rows[0].email;

    // 2. Insert rule
    const result = await pool.query(
      `INSERT INTO reserve_rules 
      (doctor_id, doctor_name, doctor_email, reserved_count, date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [doctor_id, doctor_name, doctor_email, reserved_count, date]
    );

    res.json({
      message: "Rule created",
      data: result.rows[0],
    });

  } catch (err) {
    console.error("ERROR:", err); // 👈 MUST SEE THIS IN LOGS
    res.status(500).json({ error: err.message });
  }
});


// 📥 GET ALL RULES
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM reserve_rules ORDER BY id DESC"
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ✏️ UPDATE RULE
router.put("/update/:id", async (req, res) => {
  try {
    const { doctor_name, doctor_email, reserved_count, date } = req.body;

    const result = await pool.query(
      `UPDATE reserve_rules 
       SET doctor_name=$1, doctor_email=$2, reserved_count=$3, date=$4
       WHERE id=$5
       RETURNING *`,
      [doctor_name, doctor_email, reserved_count, date, req.params.id]
    );

    res.json({ message: "Updated", data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ❌ DELETE RULE
router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM reserve_rules WHERE id=$1", [
      req.params.id,
    ]);

    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;