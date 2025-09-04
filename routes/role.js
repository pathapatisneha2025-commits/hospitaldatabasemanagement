const express = require('express');
const pool = require('../db'); // Make sure your db.js is in the parent folder
const router = express.Router();
// Create a new role
router.post('/add', async (req, res) => {
  const { role_name } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO role (role_name) VALUES ($1) RETURNING *',
      [role_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});
// Get all roles
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM role ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Get a single role by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM role WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).send('Role not found');
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});



// Update a role
router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const { role_name } = req.body;
  try {
    const result = await pool.query(
      'UPDATE role SET role_name = $1 WHERE id = $2 RETURNING *',
      [role_name, id]
    );
    if (result.rows.length === 0) return res.status(404).send('Role not found');
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Delete a role
router.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM role WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) return res.status(404).send('Role not found');
    res.send('Role deleted successfully');
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

module.exports = router;
