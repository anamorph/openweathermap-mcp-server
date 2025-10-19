#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WeatherMcpStack } from './lib/weather-mcp-stack';

const app = new cdk.App();
new WeatherMcpStack(app, 'WeatherMcpStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
