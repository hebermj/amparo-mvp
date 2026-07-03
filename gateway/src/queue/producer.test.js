import { jest } from '@jest/globals';

// Mock amqplib before importing the producer
const mockCreateChannel = jest.fn();
const mockAssertExchange = jest.fn();
const mockPublish = jest.fn();
const mockCloseChannel = jest.fn();
const mockCloseConnection = jest.fn();
const mockOn = jest.fn();

const mockChannel = {
  assertExchange: mockAssertExchange,
  publish: mockPublish,
  close: mockCloseChannel,
  on: mockOn,
};

const mockConnection = {
  createChannel: mockCreateChannel,
  close: mockCloseConnection,
  on: mockOn,
};

jest.unstable_mockModule('amqplib', () => ({
  default: {
    connect: jest.fn(() => Promise.resolve(mockConnection)),
  },
}));

const { connect, publishTextMessage, publishAudioMessage, close } = await import('./producer.js');

describe('RabbitMQ Producer', () => {
  const sampleTextMsg = {
    type: 'text',
    from: '5511999999999',
    messageId: 'wamid.test123',
    timestamp: 1719876543,
    content: { text: 'Olá' },
  };

  const sampleAudioMsg = {
    type: 'audio',
    from: '5511888888888',
    messageId: 'wamid.audio456',
    timestamp: 1719876544,
    content: { audioId: 'media_id_abc' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('connect', () => {
    it('should connect to RabbitMQ and assert the exchange', async () => {
      mockCreateChannel.mockResolvedValue(mockChannel);
      mockAssertExchange.mockResolvedValue(undefined);

      await connect('amqp://localhost:5672');

      expect(mockCreateChannel).toHaveBeenCalledTimes(1);
      expect(mockAssertExchange).toHaveBeenCalledWith('amparo', 'topic', { durable: true });
    });

    it('should throw if channel creation fails', async () => {
      mockCreateChannel.mockRejectedValue(new Error('Connection refused'));

      await expect(connect('amqp://localhost:5672')).rejects.toThrow('Connection refused');
    });
  });

  describe('publishTextMessage', () => {
    it('should publish a text message to the processamento routing key', async () => {
      mockPublish.mockReturnValue(true);

      mockCreateChannel.mockResolvedValue(mockChannel);
      mockAssertExchange.mockResolvedValue(undefined);
      await connect('amqp://localhost:5672');

      const result = await publishTextMessage(sampleTextMsg, 'trace-123');

      expect(result).toBe(true);
      expect(mockPublish).toHaveBeenCalledTimes(1);

      const [exchange, routingKey, buffer, options] = mockPublish.mock.calls[0];
      expect(exchange).toBe('amparo');
      expect(routingKey).toBe('processamento');
      expect(options).toMatchObject({ persistent: true, contentType: 'application/json' });

      const payload = JSON.parse(buffer.toString());
      expect(payload).toMatchObject({
        type: 'text',
        from: '5511999999999',
        messageId: 'wamid.test123',
        content: { text: 'Olá' },
        traceId: 'trace-123',
      });
    });

    it('should return false when publish fails', async () => {
      mockPublish.mockReturnValue(false);

      mockCreateChannel.mockResolvedValue(mockChannel);
      mockAssertExchange.mockResolvedValue(undefined);
      await connect('amqp://localhost:5672');

      const result = await publishTextMessage(sampleTextMsg);
      expect(result).toBe(false);
    });

    it('should return false when channel is not available', async () => {
      await close(); // Reset state so channel becomes null
      const result = await publishTextMessage(sampleTextMsg);
      expect(result).toBe(false);
    });
  });

  describe('publishAudioMessage', () => {
    it('should publish an audio message to the transcricao routing key', async () => {
      mockPublish.mockReturnValue(true);

      mockCreateChannel.mockResolvedValue(mockChannel);
      mockAssertExchange.mockResolvedValue(undefined);
      await connect('amqp://localhost:5672');

      const result = await publishAudioMessage(sampleAudioMsg, 'trace-audio');

      expect(result).toBe(true);
      expect(mockPublish).toHaveBeenCalledTimes(1);

      const [exchange, routingKey, buffer, options] = mockPublish.mock.calls[0];
      expect(exchange).toBe('amparo');
      expect(routingKey).toBe('transcricao');
      expect(options).toMatchObject({ persistent: true, contentType: 'application/json' });

      const payload = JSON.parse(buffer.toString());
      expect(payload).toMatchObject({
        type: 'audio',
        from: '5511888888888',
        messageId: 'wamid.audio456',
        content: { audioId: 'media_id_abc' },
        traceId: 'trace-audio',
      });
    });

    it('should return false when channel is not available', async () => {
      await close(); // Reset state so channel becomes null
      const result = await publishAudioMessage(sampleAudioMsg);
      expect(result).toBe(false);
    });
  });

  describe('close', () => {
    it('should close channel and connection', async () => {
      mockCreateChannel.mockResolvedValue(mockChannel);
      mockAssertExchange.mockResolvedValue(undefined);
      mockCloseChannel.mockResolvedValue(undefined);
      mockCloseConnection.mockResolvedValue(undefined);

      await connect('amqp://localhost:5672');
      await close();

      expect(mockCloseChannel).toHaveBeenCalledTimes(1);
      expect(mockCloseConnection).toHaveBeenCalledTimes(1);
    });

    it('should not throw if already disconnected', async () => {
      await close(); // no connection
      expect(mockCloseChannel).not.toHaveBeenCalled();
      expect(mockCloseConnection).not.toHaveBeenCalled();
    });
  });
});
