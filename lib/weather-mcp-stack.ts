import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export class WeatherMcpStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const weatherFunction = new lambda.Function(this, 'WeatherMcpFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('.', {
        exclude: ['cdk.out', 'node_modules', '*.ts', 'lib', 'app.ts', 'tsconfig.json', 'cdk.json', 'generated-diagrams']
      }),
      timeout: cdk.Duration.seconds(30),
      environment: {
        OPENWEATHER_API_KEY_PARAM: '/weather-mcp/openweather-api-key',
      },
    });

    // Grant permission to read SSM parameter
    weatherFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParameterHistory'
      ],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/weather-mcp/openweather-api-key`
      ]
    }));

    const api = new apigateway.RestApi(this, 'WeatherMcpApi', {
      restApiName: 'Weather MCP Service',
      description: 'Weather MCP Server API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const weatherIntegration = new apigateway.LambdaIntegration(weatherFunction);
    api.root.addResource('weather').addMethod('POST', weatherIntegration);

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'Weather MCP API URL',
    });
  }
}
