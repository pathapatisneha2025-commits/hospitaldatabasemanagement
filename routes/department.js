const express = require('express');
const pool = require('../db'); // make sure db.js is one level up
const router = express.Router();
// Create a new department
router.post('/add', async (req, res) => {
  const { department_name } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO department (department_name) VALUES ($1) RETURNING *',
      [department_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});
// Get all departments
router.get('/all', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM department ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Get a single department by ID
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM department WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).send('Department not found');
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});



// Update a department
router.put('/update/:id', async (req, res) => {
  const { id } = req.params;
  const { department_name } = req.body;
  try {
    const result = await pool.query(
      'UPDATE department SET department_name = $1 WHERE id = $2 RETURNING *',
      [department_name, id]
    );
    if (result.rows.length === 0) return res.status(404).send('Department not found');
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
});

// Delete a department
router.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'DELETE FROM department WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Department not found' });
    }

    // Send JSON response instead of plain text
    res.json({ message: 'Department deleted successfully', deleted: result.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
