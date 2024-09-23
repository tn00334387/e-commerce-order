const Order = require('../models/order')
const Axios = require('axios');
const mongoose = require('mongoose')
const Kafka = require('../libs/kafka')
const KafkaService = new Kafka(process.env.KAFKA_HOST_URI);

// 初始化 Consumer 處理 Kafka 消息
async function initConsumer() {
    // 訂閱支付成功的 Kafka 主题
    await KafkaService.initConsumer(['ec-payment'], 'ec-payment-consumer1', async (message) => {
        try {
            // 解析 Kafka 消息
            const paymentInfo = JSON.parse(message.value.toString());
            const { orderId, status } = paymentInfo;
    
            if (!mongoose.Types.ObjectId.isValid(orderId)) {
                console.log(`UpdateOrderStatus Q : Invalid orderId`)
                throw new Error('Invalid orderId') 
            }

            const order = await Order.findById(orderId);
            if (!order) {
                console.log(`UpdateOrderStatus Q : order-${orderId} is unexist`)
                throw new Error(`order-${orderId} is unexist`) 
            }   

            order.status = status;
            await order.save();
            console.log(`order-${orderId} update succeed - Q`)

        } catch (error) {
            console.error('Error processing payment-success message:', error);
        }
    });
}
initConsumer();  


const OrderModule = {

    CreateOrder: async (req, res) => {

        const { userId } = req.body;

        try {

            // 从购物车服务获取用户的购物车数据
            const cartResponse = await Axios.get(`${process.env.CART_HOST_URI}/api/cart/cart/${userId}`);
            const cart = cartResponse.data;

            if (!cart || cart.items.length === 0) {
                console.log(`CreateOrder : user-${userId} cart is empty`)
                res.status(400).json({ 
                    status: `Empty`,
                    message: 'Cart is empty' 
                })
                return
            }

            // 计算订单总金额
            const total = cart.items.reduce((sum, item) => sum + item.quantity * item.productPrice, 0);
            console.log(cart)
            // 创建订单
            const order = new Order({
                userId,
                items: cart.items,
                total,
                status: 'Pending',
            });

            await order.save();

            // 清空购物车
            await Axios.delete(`${process.env.CART_HOST_URI}/api/cart/cart/clear/${userId}`);

            res.status(201).json(order);            

        } catch (error) {
            console.log(`Order - CreateOrder : `, error)
            res.status(500).json({ 
                status: `Failed`,
                message: 'CreateOrder failed' 
            });
        }

    },

    GetUserOrders: async (req, res) => {

        const { userId } = req.params;

        try {   
            const orders = await Order.find({ userId });
            res.json(orders);

        } catch (error) {
            console.log(`Order - GetUserOrders : `, error)
            res.status(500).json({ 
                status: "Failed",
                message: 'GetUserOrders failed' 
            });
        }
    },

    GetOrderById: async (req, res) => {

        const { id: orderId } = req.params

        try {

            if (!mongoose.Types.ObjectId.isValid(orderId)) {
                console.log(`UpdateCartItem : Invalid orderId`)
                res.status(422).send({ 
                    status: `Unprocessable_Entity`,
                    message: 'Invalid orderId' 
                });
                return 
            }

            const order = await Order.findById(orderId);
            if (!order) {
                console.log(`GetOrderById : order-${orderId} is unexist`)
                res.status(404).json({ 
                    status: `NOT_FOUND`,
                    message: 'Order not found' 
                })
                return 
            }
            res.json(order);
        } catch (error) {
            console.log(`Order - GetOrderById : `, error)
            res.status(500).json({ 
                status: `Failed`,
                message: 'GetOrderById failed' 
            });
        }
    },

    UpdateOrderStatus: async (req, res) => {

        const { id: orderId } = req.params
        const { status } = req.body;

        try {

            if (!mongoose.Types.ObjectId.isValid(orderId)) {
                console.log(`UpdateOrderStatus : Invalid orderId`)
                res.status(422).send({ 
                    status: `Unprocessable_Entity`,
                    message: 'Invalid orderId'
                });
                return 
            }

            const order = await Order.findById(orderId);
            if (!order) {
                console.log(`UpdateOrderStatus : order-${orderId} is unexist`)
                res.status(404).json({ 
                    status: `NOT_FOUND`,
                    message: 'Order not found' 
                });
                return
            }   

            order.status = status;
            await order.save();
            console.log(`order-${orderId} update succeed`)
            res.json(order);

        } catch (error) {
            console.log(`Order - UpdateOrderStatus : `, error)
            res.status(500).json({ 
                status: `Failed`,
                message: 'UpdateOrderStatus failed' 
            });
        }
    },

    DeleteOrder: async (req, res) => {

        const { id: orderId } = req.params;

        try {

            if (!mongoose.Types.ObjectId.isValid(orderId)) {
                console.log(`DeleteOrder : Invalid orderId`)
                res.status(422).send({ 
                    status: `Unprocessable_Entity`,
                    message: 'Invalid orderId'
                });
                return 
            }

            const order = await Order.findById(orderId);

            if (!order) {
                console.log(`DeleteOrder : order-${orderId} is unexist`)
                res.status(404).json({ 
                    status: `NOT_FOUND`,
                    message: 'Order not found' 
                })
                return ;
            }

            await order.deleteOne();

            console.log(`order-${orderId} remove succeed`)

            res.json({ message: 'Order removed' });
        } catch (error) {
            console.log(`Order - DeleteOrder : `, error)
            res.status(500).json({ 
                status: `Failed`,
                message: 'DeleteOrder failed' 
            });
        }
    },

}

module.exports = OrderModule;