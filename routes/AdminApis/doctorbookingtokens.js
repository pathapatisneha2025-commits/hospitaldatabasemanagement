const express = require("express");
const router = express.Router();
const db = require("../../db"); // PostgreSQL or MySQL connection instance

// --------------------------------------
//  Add Doctor Visit Record
// --------------------------------------
router.post("/add", async (req, res) => {
  try {
    const { doctor_email, doctor_name, number_of_visits_per_day, visit_date } = req.body;

    if (!doctor_email || !doctor_name || number_of_visits_per_day === undefined) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const dateToUse = visit_date || new Date().toISOString().split("T")[0];

    // Insert new record and return the inserted row
    const result = await db.query(
      "INSERT INTO doctor_visits (doctor_email, doctor_name, number_of_visits_per_day, visit_date) VALUES ($1, $2, $3, $4) RETURNING *",
      [doctor_email, doctor_name, number_of_visits_per_day, dateToUse]
    );

    res.json({
      message: "Visit record added successfully",
      data: result.rows[0] // the inserted record
    });
  } catch (error) {
    console.error("Error adding visit record:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// --------------------------------------
//  Update Doctor Visit Record by ID
// --------------------------------------
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { doctor_email, doctor_name, number_of_visits_per_day, visit_date } = req.body;

    // Check if record exists
    const existing = await db.query("SELECT * FROM doctor_visits WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "Visit record not found" });
    }

    // Update fields (only if provided)
    await db.query(
      `UPDATE doctor_visits
       SET doctor_email = COALESCE($1, doctor_email),
           doctor_name = COALESCE($2, doctor_name),
           number_of_visits_per_day = COALESCE($3, number_of_visits_per_day),
           visit_date = COALESCE($4, visit_date)
       WHERE id = $5`,
      [doctor_email, doctor_name, number_of_visits_per_day, visit_date, id]
    );

    res.json({ message: "Visit record updated successfully" });
  } catch (error) {
    console.error("Error updating visit record:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// --------------------------------------
//  Get All Doctor Visit Records
// --------------------------------------
router.get("/all", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM doctor_visits ORDER BY visit_date DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching visit records:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// --------------------------------------
//  Delete Visit Record
// --------------------------------------
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query("DELETE FROM doctor_visits WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Visit record not found" });
    }

    res.json({ message: "Visit record deleted successfully" });
  } catch (error) {
    console.error("Error deleting visit record:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
