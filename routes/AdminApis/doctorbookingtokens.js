const express = require("express");
const router = express.Router();
const db = require("../../db"); // PostgreSQL or MySQL connection instance

// --------------------------------------
//  Add Doctor Visit Limit (set once per doctor)
// --------------------------------------
router.post("/add", async (req, res) => {
  try {
    const { doctor_email, doctor_name, number_of_visits_per_day } = req.body;

    if (!doctor_email || !doctor_name || number_of_visits_per_day === undefined) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Check if doctor already has a record
    const existing = await db.query(
      "SELECT * FROM doctor_visits WHERE LOWER(doctor_email) = LOWER($1)",
      [doctor_email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        message: "Visit limit already set for this doctor. Use update API to modify it.",
      });
    }

    // Insert new static visit limit
    const result = await db.query(
      "INSERT INTO doctor_visits (doctor_email, doctor_name, number_of_visits_per_day) VALUES ($1, $2, $3) RETURNING *",
      [doctor_email, doctor_name, number_of_visits_per_day]
    );

    res.json({
      message: "Doctor visit limit added successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Error adding visit record:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// --------------------------------------
//  Update Doctor Visit Limit by ID
// --------------------------------------
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { doctor_email, doctor_name, number_of_visits_per_day } = req.body;

    // Check if record exists
    const existing = await db.query("SELECT * FROM doctor_visits WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ message: "Visit limit record not found" });
    }

    // Update fields (only if provided)
    await db.query(
      `UPDATE doctor_visits
       SET doctor_email = COALESCE($1, doctor_email),
           doctor_name = COALESCE($2, doctor_name),
           number_of_visits_per_day = COALESCE($3, number_of_visits_per_day)
       WHERE id = $4`,
      [doctor_email, doctor_name, number_of_visits_per_day, id]
    );

    res.json({ message: "Doctor visit limit updated successfully" });
  } catch (error) {
    console.error("❌ Error updating visit record:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// --------------------------------------
//  Get All Doctor Visit Limits
// --------------------------------------
router.get("/all", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM doctor_visits ORDER BY doctor_name ASC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching visit records:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// --------------------------------------
//  Delete Visit Limit Record
// --------------------------------------
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query("DELETE FROM doctor_visits WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Visit limit record not found" });
    }

    res.json({ message: "Doctor visit limit deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting visit record:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
