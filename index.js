const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const axios = require('axios');

const BASE_URL = 'https://api.openweathermap.org/data/2.5';
let OPENWEATHER_API_KEY;

// AWS SDK for SSM
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || 'us-east-1' });

async function getApiKey() {
  if (!OPENWEATHER_API_KEY) {
    const paramName = process.env.OPENWEATHER_API_KEY_PARAM || '/weather-mcp/openweather-api-key';
    const command = new GetParameterCommand({
      Name: paramName,
      WithDecryption: true,
    });
    const response = await ssmClient.send(command);
    OPENWEATHER_API_KEY = response.Parameter.Value;
  }
  return OPENWEATHER_API_KEY;
}

class WeatherMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'weather-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler('tools/list', async () => ({
      tools: [
        {
          name: 'get_current_weather',
          description: 'Get current weather for a city',
          inputSchema: {
            type: 'object',
            properties: {
              city: {
                type: 'string',
                description: 'City name',
              },
              units: {
                type: 'string',
                enum: ['metric', 'imperial', 'kelvin'],
                default: 'metric',
                description: 'Temperature units',
              },
            },
            required: ['city'],
          },
        },
        {
          name: 'get_weather_forecast',
          description: 'Get 5-day weather forecast for a city',
          inputSchema: {
            type: 'object',
            properties: {
              city: {
                type: 'string',
                description: 'City name',
              },
              units: {
                type: 'string',
                enum: ['metric', 'imperial', 'kelvin'],
                default: 'metric',
                description: 'Temperature units',
              },
            },
            required: ['city'],
          },
        },
        {
          name: 'compare_weather',
          description: 'Compare current weather between multiple locations. Great for helping users choose between destination options.',
          inputSchema: {
            type: 'object',
            properties: {
              cities: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Array of city names to compare',
              },
              units: {
                type: 'string',
                enum: ['metric', 'imperial', 'kelvin'],
                default: 'metric',
                description: 'Temperature units',
              },
            },
            required: ['cities'],
          },
        },
      ],
    }));

    this.server.setRequestHandler('tools/call', async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'get_current_weather':
            return await this.getCurrentWeather(args.city, args.units || 'metric');
          case 'get_weather_forecast':
            return await this.getWeatherForecast(args.city, args.units || 'metric');
          case 'compare_weather':
            return await this.compareWeather(args.cities, args.units || 'metric');
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async getCurrentWeather(city, units) {
    const apiKey = await getApiKey();
    const response = await axios.get(`${BASE_URL}/weather`, {
      params: {
        q: city,
        appid: apiKey,
        units: units,
      },
    });

    const data = response.data;
    const unitSymbol = units === 'imperial' ? '°F' : units === 'kelvin' ? 'K' : '°C';

    return {
      content: [
        {
          type: 'text',
          text: `Current weather in ${data.name}, ${data.sys.country}:
Temperature: ${data.main.temp}${unitSymbol} (feels like ${data.main.feels_like}${unitSymbol})
Condition: ${data.weather[0].description}
Humidity: ${data.main.humidity}%
Wind: ${data.wind.speed} ${units === 'imperial' ? 'mph' : 'm/s'}
Pressure: ${data.main.pressure} hPa`,
        },
      ],
    };
  }

  async getWeatherForecast(city, units) {
    const apiKey = await getApiKey();
    const response = await axios.get(`${BASE_URL}/forecast`, {
      params: {
        q: city,
        appid: apiKey,
        units: units,
      },
    });

    const data = response.data;
    const unitSymbol = units === 'imperial' ? '°F' : units === 'kelvin' ? 'K' : '°C';
    
    const forecast = data.list.slice(0, 5).map(item => {
      const date = new Date(item.dt * 1000).toLocaleDateString();
      return `${date}: ${item.main.temp}${unitSymbol}, ${item.weather[0].description}`;
    }).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `5-day forecast for ${data.city.name}, ${data.city.country}:\n${forecast}`,
        },
      ],
    };
  }

  async compareWeather(cities, units) {
    const unitSymbol = units === 'imperial' ? '°F' : units === 'kelvin' ? 'K' : '°C';
    const weatherData = [];
    const apiKey = await getApiKey();

    for (const city of cities) {
      try {
        const response = await axios.get(`${BASE_URL}/weather`, {
          params: {
            q: city,
            appid: apiKey,
            units: units,
          },
        });

        const data = response.data;
        weatherData.push({
          city: `${data.name}, ${data.sys.country}`,
          temp: data.main.temp,
          condition: data.weather[0].description,
          humidity: data.main.humidity,
          wind: data.wind.speed,
        });
      } catch (error) {
        weatherData.push({
          city: city,
          error: 'City not found or API error',
        });
      }
    }

    const comparison = weatherData.map(data => {
      if (data.error) {
        return `${data.city}: ${data.error}`;
      }
      return `${data.city}: ${data.temp}${unitSymbol}, ${data.condition}, ${data.humidity}% humidity, ${data.wind} ${units === 'imperial' ? 'mph' : 'm/s'} wind`;
    }).join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `Weather comparison:\n${comparison}`,
        },
      ],
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

// Lambda handler for AWS
exports.handler = async (event, context) => {
  const server = new WeatherMCPServer();
  
  // Handle MCP requests in Lambda
  if (event.method === 'tools/list') {
    return await server.server.request({ method: 'tools/list' });
  } else if (event.method === 'tools/call') {
    return await server.server.request({ 
      method: 'tools/call', 
      params: event.params 
    });
  }
  
  return { statusCode: 400, body: 'Invalid request' };
};

// For local development
if (require.main === module) {
  const server = new WeatherMCPServer();
  server.run().catch(console.error);
}
