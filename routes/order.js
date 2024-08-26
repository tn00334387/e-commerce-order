const express = require('express');
const router = express.Router();
const OrderModule = require('../modules/order');

// 定義註冊和登錄路由
router.post('/orders', OrderModule.CreateOrder);
router.get('/orders/:userId', OrderModule.GetUserOrders);
router.get('/orders/:id', OrderModule.GetOrderById);
router.put('/orders/:id', OrderModule.UpdateOrderStatus);
router.delete('/orders/:id', OrderModule.DeleteOrder);

module.exports = router;