const express = require("express");
const router = express.Router();
const pool = require("../db");

/*
-----------------------------------
GET ALL SLOTS
-----------------------------------
*/
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        ds.id,
        ds.doctor_id,
        d.name AS doctor_name,
        ds.slot_date,
        ds.slot_time,
        ds.token_limit,
        ds.created_at
      FROM doctor_slots ds
      JOIN doctors d ON ds.doctor_id = d.id
      ORDER BY ds.slot_date ASC, ds.slot_time ASC
    `);

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
-----------------------------------
GET SLOTS BY DOCTOR ID + DATE
-----------------------------------
*/
router.get("/:doctorId", async (req, res) => {
  const { doctorId } = req.params;
  const { date } = req.query;

  try {
    const result = await pool.query(
      `SELECT 
        id,
        slot_time,
        token_limit
       FROM doctor_slots 
       WHERE doctor_id=$1 AND slot_date=$2 
       ORDER BY slot_time ASC`,
      [doctorId, date]
    );

    res.json({ slots: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
-----------------------------------
ADD SLOT (WITH TOKEN LIMIT)
-----------------------------------
*/
router.post("/add-slot", async (req, res) => {
  const { doctor_id, date, slot, token_limit } = req.body;

  if (!doctor_id || !date || !slot) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    await pool.query(
      `INSERT INTO doctor_slots 
        (doctor_id, slot_date, slot_time, token_limit) 
       VALUES ($1, $2, $3, $4)`,
      [doctor_id, date, slot, token_limit || 0]
    );

    res.json({ message: "Slot added successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
-----------------------------------
DELETE SLOT BY ID
-----------------------------------
*/
router.delete("/delete-slot/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "DELETE FROM doctor_slots WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Slot not found" });
    }

    res.json({ message: "Slot deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/*
-----------------------------------
EDIT SLOT (TIME + TOKEN LIMIT)
-----------------------------------
*/
router.put("/edit-slot/:id", async (req, res) => {
  const { id } = req.params;
  const { slot, token_limit } = req.body;

  try {
    const result = await pool.query(
      `UPDATE doctor_slots 
       SET slot_time=$1, token_limit=$2 
       WHERE id=$3`,
      [slot, token_limit, id]
    );

    if (result.rowCount === 0) {
      return res.status(400).json({ message: "No slot updated" });
    }

    res.json({ message: "Slot updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;