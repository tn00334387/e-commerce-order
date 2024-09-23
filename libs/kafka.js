const Kafka = require('node-rdkafka');

class KafkaService {

    constructor(brokers) {
        this.brokers = brokers;
        this.producer = null;
        this.consumer = null;
    }

    // 初始化生产者
    initProducer() {
        return new Promise((resolve, reject) => {
            this.producer = new Kafka.Producer({
                'metadata.broker.list': this.brokers,
                'security.protocol': 'plaintext',
                'dr_cb': true,
            });

            this.producer.connect();
            this.producer.on('ready', () => {
                console.log('Producer is ready');
                resolve();
            });

            this.producer.on('event.error', (err) => {
                console.error('Producer error:', err);
                reject(err);
            });
        });
    }

    sendMessage(topic, message) {
        return new Promise((resolve, reject) => {
            if (!this.producer) {
                return reject('Producer not initialized');
            }

            this.producer.produce(
                topic,
                null, // partition (null means Kafka will decide)
                Buffer.from(message), // message must be a buffer
                null, // optional key
                Date.now() // timestamp
            );
            
            this.producer.flush(1000, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve('Message sent successfully');
                }
            });
        });
    }

  // 初始化消费者
    initConsumer(topics, groupId, messageHandler) {
        return new Promise((resolve, reject) => {
            this.consumer = new Kafka.KafkaConsumer({
                'group.id': groupId,
                'metadata.broker.list': this.brokers,
                'auto.offset.reset': 'earliest',
            });

            this.consumer.connect();

            this.consumer.on('ready', () => {
                console.log('Consumer is ready');
                this.consumer.subscribe(topics);
                this.consumer.consume(); // start consuming
                resolve();
            });

            this.consumer.on('data', (message) => {
                if (messageHandler) {
                    messageHandler(message); // 调用自定义的消息处理函数
                } else {
                    this.onMessage(message); // 默认的消息处理逻辑
                }
            });

            this.consumer.on('event.error', (err) => {
                console.error('Consumer error:', err);
                reject(err);
            });
        });
    }

    // 消费消息的处理函数
    onMessage(message) {
        try {
            const value = message.value.toString();
            console.log(`Received message: ${value}`);
            // Here, you can handle the received message and process it
        } catch (error) {
            console.error('Error processing message:', error);
        }
    }

    // 停止消费者
    stopConsumer() {
        if (this.consumer) {
            this.consumer.disconnect();
        }
    }
}

module.exports = KafkaService;