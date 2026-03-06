# Networking Reference

## VPC Design

### Standard VPC Pattern

```typescript
import * as ec2 from 'aws-cdk-lib/aws-ec2';

const vpc = new ec2.Vpc(this, 'Vpc', {
  // CIDR block — use /16 for flexibility
  ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),

  // Availability zones
  maxAzs: 2,      // 2 for non-prod (cost), 3 for prod (HA)

  // Subnets — CDK creates one of each type per AZ
  subnetConfiguration: [
    {
      name: 'Public',
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask: 24,
    },
    {
      name: 'Private',
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      cidrMask: 24,
    },
    {
      name: 'Isolated',
      subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      cidrMask: 28,  // Small — for RDS, ElastiCache only
    },
  ],

  // NAT Gateways — 1 per AZ by default (expensive!)
  // Non-prod: 1 NAT. Prod: 1 per AZ for HA.
  natGateways: props.environment === 'prod' ? 2 : 1,

  // Flow logs for security auditing
  flowLogs: {
    s3: {
      destination: ec2.FlowLogDestination.toS3(flowLogBucket),
    },
  },
});
```

### VPC Endpoints (Cost & Security)

Add VPC endpoints for AWS services to avoid routing through NAT Gateway:

```typescript
// S3 Gateway endpoint — free, high priority
vpc.addGatewayEndpoint('S3Endpoint', {
  service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
});
vpc.addGatewayEndpoint('DynamoEndpoint', {
  service: ec2.GatewayVpcEndpointAwsService.S3,
});

// Interface endpoints for other services (small hourly cost, but < NAT cost at scale)
vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
  privateDnsEnabled: true,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
});

vpc.addInterfaceEndpoint('SsmEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.SSM,
  privateDnsEnabled: true,
});
```

---

## Security Groups

```typescript
// Application Load Balancer SG
const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
  vpc,
  description: 'ALB — allow 443 from internet',
  allowAllOutbound: false, // Always explicit
});
albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS from internet');
albSg.addEgressRule(appSg, ec2.Port.tcp(8080), 'To app');

// Application SG — only accept traffic from ALB
const appSg = new ec2.SecurityGroup(this, 'AppSg', {
  vpc,
  description: 'App — allow from ALB only',
  allowAllOutbound: false,
});
appSg.addIngressRule(albSg, ec2.Port.tcp(8080), 'From ALB');
appSg.addEgressRule(dbSg, ec2.Port.tcp(5432), 'To RDS');
appSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS egress for AWS APIs');

// Database SG — only accept traffic from App
const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
  vpc,
  description: 'RDS — allow from app only',
  allowAllOutbound: false,
});
dbSg.addIngressRule(appSg, ec2.Port.tcp(5432), 'From app');
```

---

## Lambda in VPC

**Only put Lambda in a VPC when it needs to access VPC resources** (RDS, ElastiCache, internal services). VPC adds ~100ms to cold starts.

```typescript
const fn = new lambdaNodejs.NodejsFunction(this, 'DbHandler', {
  vpc,
  // Use PRIVATE_WITH_EGRESS if Lambda needs internet access (via NAT)
  // Use PRIVATE_ISOLATED if Lambda only needs VPC-internal resources
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  securityGroups: [lambdaSg],
  // ...
});
```

---

## Application Load Balancer

```typescript
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';

const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
  vpc,
  internetFacing: true,
  securityGroup: albSg,
});

// Redirect HTTP → HTTPS
alb.addListener('HttpListener', {
  port: 80,
  defaultAction: elbv2.ListenerAction.redirect({
    protocol: 'HTTPS',
    port: '443',
    permanent: true,
  }),
});

const httpsListener = alb.addListener('HttpsListener', {
  port: 443,
  certificates: [acm.Certificate.fromCertificateArn(this, 'Cert', props.certArn)],
  sslPolicy: elbv2.SslPolicy.TLS13_RES, // TLS 1.3 only
});

httpsListener.addTargets('AppTargets', {
  port: 8080,
  targets: [new elbv2targets.LambdaTarget(fn)],
  healthCheck: {
    path: '/health',
    healthyHttpCodes: '200',
  },
});
```

---

## Route 53

```typescript
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';

const zone = route53.HostedZone.fromLookup(this, 'Zone', {
  domainName: 'example.com',
});

new route53.ARecord(this, 'ApiRecord', {
  zone,
  recordName: 'api',
  target: route53.RecordTarget.fromAlias(
    new route53targets.LoadBalancerTarget(alb),
  ),
});
```
