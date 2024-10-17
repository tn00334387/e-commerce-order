const express = require('express');
const router = express.Router();
const OrderModule = require('../modules/order');

// 定義註冊和登錄路由
router.post('/orders', OrderModule.CreateOrder);
router.get('/orders', OrderModule.GetUserOrders);
router.get('/orders/:id', OrderModule.GetOrderById);
router.put('/orders/:id', OrderModule.UpdateOrderStatus);
router.delete('/orders/:id', OrderModule.DeleteOrder);

router.post('/orders_r', OrderModule.CreateOrderR);
router.get('/orders_r', OrderModule.GetUserOrdersR);
router.get('/orders_r/:id', OrderModule.GetOrderByIdR);
router.put('/orders_r/:id', OrderModule.UpdateOrderStatusR);
router.delete('/orders_r/:id', OrderModule.DeleteOrderR);

module.exports = router;