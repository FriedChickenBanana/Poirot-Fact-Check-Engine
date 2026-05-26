const express = require('express');
const { verifyFactCheck } = require('../controllers/verifyController');

const router = express.Router();

router.post('/', verifyFactCheck);

module.exports = router;