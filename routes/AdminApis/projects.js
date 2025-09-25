const express = require('express');
const router = express.Router();
const pool = require("../../db"); // Adjust path if needed

// -------------------- CREATE (POST) --------------------
router.post('/add', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: "Name is required" });
        }
        const result = await pool.query(
            'INSERT INTO projects (name) VALUES ($1) RETURNING *',
            [name]
        );
        res.status(201).json({ success: true, project: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------- READ ALL (GET) --------------------
router.get('/all', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM projects ORDER BY id ASC');
        res.status(200).json({ success: true, projects: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------- READ SINGLE (GET) --------------------
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Project not found" });
        }
        res.status(200).json({ success: true, project: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------- UPDATE (PUT) --------------------
router.put('/update/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ success: false, message: "Name is required" });
        }
        const result = await pool.query(
            'UPDATE projects SET name = $1 WHERE id = $2 RETURNING *',
            [name, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Project not found" });
        }
        res.status(200).json({ success: true, project: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------- DELETE (DELETE) --------------------
router.delete('/delete/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM projects WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Project not found" });
        }
        res.status(200).json({ success: true, message: "Project deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
