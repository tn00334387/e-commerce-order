const Redis = require('ioredis');
const dotenv = require('dotenv');
dotenv.config();

const clusterNodes = process.env.REDIS_HOST_URL.split(',').map(node => {
  const [host, port] = node.split(':');
  return { host, port: parseInt(port) };
});

const clusterOptions = {}
if (process.env.REDIS_MAPPER_URL){
  clusterOptions.natMap = {}
  process.env.REDIS_MAPPER_URL.split(',').forEach( (mapURL, index) => {
    clusterOptions.natMap[mapURL] = clusterNodes[index]
  })
}

class RedisClient {
    constructor() {
        // Init Redis Cluster
        this.client = new Redis.Cluster(clusterNodes, clusterOptions);
        this.client.on('error', (err) => {
            console.error('Redis connection error:', err);
        });
        this.client.on('connect', () => {
            console.log('Connected to Redis Cluster');
        });
        this.client.on('nodeAdded', (node) => { // 監聽 cluster nodes 狀態
            console.log(`Node added: ${node.options.key}`);
        });
        this.client.on('ready', () => {  // 監聽準備完成事件
            console.log('Cluster is ready');
        });

        // Init pub/sub client
        this.pubSubClient = new Redis.Cluster(clusterNodes, clusterOptions);
        this.pubSubClient.on('connect', () => {
          console.log('Connected to Redis Pub/Sub Cluster');
      });
        this.pubSubClient.on('error', (err) => {
            console.error('Redis Pub/Sub Cluster connection error:', err);
        });
    }

    async get (key) {
        try {
            console.log(`Getting value for key ${key}`);
            const result = await this.client.get(key);
            return result;
        } catch (err) {
            console.error('Error getting value from Redis:', err);
            throw err;
        }
    }

    async set(key, value, expiry = 3600) {  // default expiry time is 1 hour
      try {
        await this.client.setex(key, expiry, value);
        console.log(`Key ${key} set with expiry ${expiry} seconds`);
      } catch (err) {
        console.error('Error setting value in Redis:', err);
        throw err;
      }
    }

    async del(key) {
      try {
        await this.client.del(key);
        console.log(`Key ${key} deleted`);
      } catch (err) {
        console.error('Error deleting key in Redis:', err);
        throw err;
      }
    }

    async rpush(queueName, value) {
      try {
        await this.client.rpush(queueName, value);
        console.log(`Value pushed to ${queueName}`);
      } catch (err) {
        console.error('Error pushing value to queue:', err);
        throw err;
      }
    }

    async lpop(queueName) {
      try {
        const result = await this.client.lpop(queueName);
        return result;
      } catch (err) {
        console.error('Error popping value from queue:', err);
        throw err;
      }
    }

    // 新增：订阅频道
    async subscribe(channel) {
      try {
          await this.pubSubClient.subscribe(channel);
          console.log(`Subscribed to channel: ${channel}`);
      } catch (err) {
          console.error(`Error subscribing to channel ${channel}:`, err);
          throw err;
      }
    }

    // 新增：处理接收到的消息
    onMessage(callback) {
        this.pubSubClient.on('message', (channel, message) => {
            console.log(`Received message from channel ${channel}: ${message}`);
            callback(channel, message);
        });
    }

    // 新增：发布消息
    async publish(channel, message) {
        try {
            await this.client.publish(channel, message);
            console.log(`Message published to channel ${channel}`);
        } catch (err) {
            console.error(`Error publishing message to channel ${channel}:`, err);
            throw err;
        }
    }
}

module.exports = RedisClient;
