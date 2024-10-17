const Order = require('../models/order')
const Axios = require('axios');
const mongoose = require('mongoose')
const Kafka = require('../libs/kafka')
const RedisClient = require('../libs/redis')
const redis = new RedisClient();
const KafkaService = new Kafka(process.env.KAFKA_HOST_URI);

redis.subscribe('invalidateUserOrders');
// process message from redis pub/sub channel
redis.onMessage(async (channel, message) => {
    if (channel === 'invalidateUserOrders') {
        const userId = message;
        const userOrdersCacheKey = `userOrders:${userId}`;
        await redis.del(userOrdersCacheKey);
        console.log(`userOrders cache for user-${userId} invalidated`);
    }
});

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

    // subscribe payment success kafka topic and process message with redis cache
    await KafkaService.initConsumer(['ec-payment-r'], 'ec-payment-r-consumer1', async (message) => {
        try {
            // 解析 Kafka 消息
            const paymentInfo = JSON.parse(message.value.toString());
            const { userId, orderId, status } = paymentInfo;

            const cacheKey = `order:${orderId}`;
            let order = await redis.get(cacheKey);
            if(order){  
                order = JSON.parse(order);
                console.log(`Get order-${orderId} data from redis`)
            } else {
                if (!mongoose.Types.ObjectId.isValid(orderId)) {
                    console.log(`UpdateOrderStatus QR : Invalid orderId`)
                    throw new Error('Invalid orderId') 
                }
                order = await Order.findById(orderId);
                console.log(`Get order-${orderId} data from db`)
            }

            if (!order) {
                console.log(`UpdateOrderStatus QR : order-${orderId} is unexist`)
                throw new Error(`order-${orderId} is unexist`) 
            }   

            order.status = status;
            if(!(order instanceof Order)){
                order = new Order(order);
                order.isNew = false;
            }
            await order.save();
            await redis.set(cacheKey, JSON.stringify(order), 3600);
            await redis.publish('invalidateUserOrders', userId); // invalidate userOrders cache
            console.log(`order-${orderId} update succeed - QR`)
            
        } catch (error) {
            console.error('Error processing payment-success message:', error);
        }
    });

}
initConsumer();  

const OrderModule = {

    CreateOrder: async (req, res) => {

        // const { userId } = req.body;
        const userId = req.headers['x-user-id'];

        try {

            if( !userId ){
                console.log(`User is not login`)
                res.status(401).json({ 
                    status: 'Unauthorized',
                    message: 'User is not login' 
                })
                return 
            }

            // 
            const cartResponse = await Axios.get(`${process.env.CART_HOST_URI}/api/cart/cart`, {
                headers: {
                  "x-user-id" : userId
                }
            });
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
            await Axios.delete(`${process.env.CART_HOST_URI}/api/cart/cart/clear`, {
                headers: {
                  "x-user-id" : userId
                }
            });

            res.status(201).json(order);            

        } catch (error) {
            console.log(`Order - CreateOrder : `, error)
            res.status(500).json({ 
                status: `Failed`,
                message: 'CreateOrder failed' 
            });
        }

    },

    CreateOrderR: async (req, res) => {

        const userId = req.headers['x-user-id'];

        try {

            if( !userId ){
                console.log(`User is not login`)
                res.status(401).json({ 
                    status: 'Unauthorized',
                    message: 'User is not login' 
                })
                return 
            }
            const cacheKey = `cart:${userId}`;
            let cart = await redis.get(cacheKey);

            if(cart){
                cart = JSON.parse(cart);
                console.log(`Get user-${userId} cart data from redis`)
            } else {
                const { data } = await Axios.get(`${process.env.CART_HOST_URI}/api/cart/cart_r`, {
                    headers: {
                        'x-user-id': userId
                    }
                });
                cart = data;
                console.log(`Get user-${userId} cart data from cart service`)
            }

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
            // console.log(cart)
            // 创建订单
            const order = new Order({
                userId,
                items: cart.items,
                total,
                status: 'Pending',
            });

            await order.save();

            await redis.set(`order:${order._id}`, JSON.stringify(order), 3600);
            await redis.publish('invalidateUserOrders', userId); // invalidate userOrders cache

            console.log(`order-${order._id} create succeed and save to redis`);

            // 清空购物车
            await Axios.delete(`${process.env.CART_HOST_URI}/api/cart/cart_r/clear`, {
                headers: {
                    'x-user-id': userId
                }
            });

            res.status(201).json(order);            

        } catch (error) {
            console.log(`Order - CreateOrderR : `, error)
            res.status(500).json({ 
                status: `Failed`,
                message: 'CreateOrderR failed' 
            });
        }

    },

    GetUserOrders: async (req, res) => {

        // const { userId } = req.params;
        const userId = req.headers['x-user-id'];

        try {   

            if( !userId ){
                console.log(`User is not login`)
                res.status(401).json({ 
                    status: 'Unauthorized',
                    message: 'User is not login' 
                })
                return 
            }

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

    GetUserOrdersR: async (req, res) => {

        const userId = req.headers['x-user-id'];

        try {   

            if( !userId ){
                console.log(`User is not login`)
                res.status(401).json({ 
                    status: 'Unauthorized',
                    message: 'User is not login' 
                })
                return 
            }

            const cacheKey = `userOrders:${userId}`;
            const orderCache = await redis.get(cacheKey);
            if(orderCache){
                console.log(`Get user-${userId} orders data from redis`)
                return res.status(200).json(JSON.parse(orderCache));
            }

            const orders = await Order.find({ userId });
            await redis.set(cacheKey, JSON.stringify(orders), 3600);
            console.log(`Get user-${userId} orders data from db and save to redis`)
            res.json(orders);

        } catch (error) {
            console.log(`Order - GetUserOrdersR : `, error)
            res.status(500).json({ 
                status: "Failed",
                message: 'GetUserOrdersR failed' 
            });
        }
    },

    GetOrderById: async (req, res) => {

        const { id: orderId } = req.params

        try {

            if (!mongoose.Types.ObjectId.isValid(orderId)) {
                console.log(`GetOrderById : Invalid orderId`)
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

    GetOrderByIdR: async (req, res) => {

        const { id: orderId } = req.params

        try {
            const cacheKey = `order:${orderId}`;
            const orderCache = await redis.get(cacheKey);
            if (orderCache) {
                console.log(`Get order-${orderId} data from redis`)
                return res.status(200).json(JSON.parse(orderCache));  // return order data from redis
            }

            if (!mongoose.Types.ObjectId.isValid(orderId)) {
                console.log(`GetOrderByIdR : Invalid orderId`)
                res.status(422).send({ 
                    status: `Unprocessable_Entity`,
                    message: 'Invalid orderId' 
                });
                return 
            }

            const order = await Order.findById(orderId);
            if (!order) {
                console.log(`GetOrderByIdR : order-${orderId} is unexist`)
                res.status(404).json({ 
                    status: `NOT_FOUND`,
                    message: 'Order not found' 
                })
                return 
            }
            await redis.set(`order:${orderId}`, JSON.stringify(order), 3600);
            console.log(`Get order-${orderId} data from db and save to redis`)

            res.json(order);
        } catch (error) {
            console.log(`Order - GetOrderByIdR : `, error)
            res.status(500).json({ 
                status: `Failed`,
                message: 'GetOrderByIdR failed' 
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

    UpdateOrderStatusR: async (req, res) => {

        const userId = req.headers['x-user-id'];
        const { id: orderId } = req.params
        const { status } = req.body;

        try {

            const cacheKey = `order:${orderId}`;
            let order = await redis.get(cacheKey);

            if(order){
                order = JSON.parse(order);
                console.log(`Get order-${orderId} data from redis`)
            } else {
                if (!mongoose.Types.ObjectId.isValid(orderId)) {
                    console.log(`UpdateOrderStatus : Invalid orderId`)
                    res.status(422).send({ 
                        status: `Unprocessable_Entity`,
                        message: 'Invalid orderId'
                    });
                    return 
                }
                order = await Order.findById(orderId);
                console.log(`Get order-${orderId} data from db`)
            }

            if (!order) {
                console.log(`UpdateOrderStatusR : order-${orderId} is unexist`)
                res.status(404).json({ 
                    status: `NOT_FOUND`,
                    message: 'Order not found' 
                });
                return
            }   

            order.status = status;
            if(!(order instanceof Order)){
                order = new Order(order);
                order.isNew = false;
            }
            await order.save();
            await redis.set(cacheKey, JSON.stringify(order), 3600);
            await redis.publish('invalidateUserOrders', userId); // invalidate userOrders cache
            console.log(`order-${orderId} update succeed and update to redis`)
            res.json(order);

        } catch (error) {
            console.log(`Order - UpdateOrderStatusR : `, error)
            res.status(500).json({ 
                status: `Failed`,
                message: 'UpdateOrderStatusR failed' 
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

    DeleteOrderR: async (req, res) => {

        const userId = req.headers['x-user-id'];
        const { id: orderId } = req.params;

        try {

            const cacheKey = `order:${orderId}`;
            let order = await redis.get(cacheKey);

            if(order){
                order = JSON.parse(order);
                console.log(`Get order-${orderId} data from redis`)
            } else {
                if (!mongoose.Types.ObjectId.isValid(orderId)) {
                    console.log(`DeleteOrder : Invalid orderId`)
                    res.status(422).send({ 
                        status: `Unprocessable_Entity`,
                        message: 'Invalid orderId'
                    });
                    return 
                }
                order = await Order.findById(orderId);
                console.log(`Get order-${orderId} data from db`)
            }

            if (!order) {
                console.log(`DeleteOrderR : order-${orderId} is unexist`)
                res.status(404).json({ 
                    status: `NOT_FOUND`,
                    message: 'Order not found' 
                })
                return ;
            }

            if(!(order instanceof Order)){
                order = new Order(order);
                order.isNew = false;
            }
            await order.deleteOne();
            await redis.del(cacheKey);
            await redis.publish('invalidateUserOrders', userId); // invalidate userOrders cache

            console.log(`order-${orderId} remove succeed and remove from redis`)

            res.json({ message: 'Order removed' });
        } catch (error) {
            console.log(`Order - DeleteOrderR : `, error)
            res.status(500).json({ 
                status: `Failed`,
                message: 'DeleteOrderR failed' 
            });
        }
    },

}

module.exports = OrderModule;