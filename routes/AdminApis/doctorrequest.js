const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET all items (employee can view)
router.get("/", async (req, res) => {
  const result = await pool.query("SELECT * FROM stationaryinventory ORDER BY id");
  res.json({ items: result.rows });
});

// ADD item (Admin/Subadmin)
router.post("/add", checkRole("admin","subadmin"), async (req,res)=>{
  const {name, stock, price, supplier, image_url} = req.body;
  const result = await pool.query(
    "INSERT INTO stationaryinventory (name, stock, price, supplier, image_url) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [name, stock||0, price||0, supplier||null, image_url||null]
  );
  res.json({message:"Item added", item: result.rows[0]});
});

// UPDATE item (Admin/Subadmin)
router.put("/update/:id", checkRole("admin","subadmin"), async (req,res)=>{
  const {id} = req.params;
  const {name, stock, price, supplier, image_url} = req.body;
  const result = await pool.query(
    "UPDATE stationaryinventory SET name=$1, stock=$2, price=$3, supplier=$4, image_url=$5 WHERE id=$6 RETURNING *",
    [name, stock, price, supplier, image_url, id]
  );
  res.json({message:"Item updated", item: result.rows[0]});
});

// DELETE item (Admin only)
router.delete("/delete/:id", checkRole("admin"), async (req,res)=>{
  const {id} = req.params;
  const result = await pool.query("DELETE FROM stationaryinventory WHERE id=$1 RETURNING *",[id]);
  res.json({message:"Item deleted", item: result.rows[0]});
});

module.exports = router;
