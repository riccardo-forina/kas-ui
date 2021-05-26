import React, { useState, useContext, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { DefaultApi } from 'src/openapi';
import { useAlerts } from '@app/common/MASAlerts/MASAlerts';
import { isServiceApiError } from '@app/utils';
import { AuthContext } from '@app/auth/AuthContext';
import { ApiContext } from '@app/api/ApiContext';
import { 
  AlertVariant,
  Bullseye,
  Card,
  CardTitle,
  CardBody,
  Spinner
} from '@patternfly/react-core';
import {
  Chart,
  ChartArea,
  ChartAxis,
  ChartGroup,
  ChartLegend,
  ChartThemeColor,
  ChartThreshold,
  ChartVoronoiContainer
} from '@patternfly/react-charts';
import chart_color_blue_300 from '@patternfly/react-tokens/dist/js/chart_color_blue_300';
import chart_color_black_500 from '@patternfly/react-tokens/dist/js/chart_color_black_500';
import { format } from 'date-fns';
import byteSize from 'byte-size';
import { ChartEmptyState } from './ChartEmptyState';
import { useTimeout } from '@app/hooks/useTimeout';
import { convertToSpecifiedByte, getMaxValueOfArray} from './utils';

type Broker = {
  name: string
  data: {
    timestamp: number
    usedSpaceAvg: number[]
  }[]
}

type ChartData = {
  areaColor: string
  softLimitColor: string
  area: BrokerChartData[]
  softLimit: BrokerChartData[]
}

type BrokerChartData = {
  name: string
  x: string
  y: number 
}

type LegendData = {
  name: string
  symbol: {}
}

type KafkaInstanceProps = {
  kafkaID: string
}

export const UsedDiskSpaceChart: React.FC<KafkaInstanceProps> = ({kafkaID}: KafkaInstanceProps) => {

  const containerRef = useRef();
  const { t } = useTranslation();
  const authContext = useContext(AuthContext);
  const { basePath } = useContext(ApiContext);
  const { addAlert } = useAlerts();
  const [width, setWidth] = useState();
  const [legend, setLegend] = useState()
  const [chartData, setChartData] = useState<ChartData[]>();
  const [metricsDataUnavailable, setMetricsDataUnavailable] = useState(false);
  const [chartDataLoading, setChartDataLoading] = useState(true);
  const [largestByteSize, setLargestByteSize] = useState();

  const usageLimit = 60; // Replace with limit from API

  const handleResize = () => containerRef.current && setWidth(containerRef.current.clientWidth);
  const itemsPerRow = width && width > 650 ? 6 : 3;

  const fetchUsedDiskSpaceMetrics = async () => {
    const accessToken = await authContext?.getToken();
    if (accessToken !== undefined && accessToken !== '') {
      try {
        const apisService = new DefaultApi({
          accessToken,
          basePath
        });
        if (!kafkaID) {
          return;
        }
        const data = await apisService.getMetricsByRangeQuery(kafkaID, 6 * 60, 5 * 60, ['kubelet_volume_stats_used_bytes']);

        const avgBroker = {
          name: `Used disk space`,
          data: []
        } as Broker;
        
        if(data.data.items) {
          setMetricsDataUnavailable(false);
          data.data.items?.forEach((item, index) => {
            const labels = item.metric;
            if (labels === undefined) {
              throw new Error('item.metric cannot be undefined');
            }
            if (item.values === undefined) {
              throw new Error('item.values cannot be undefined');
            }
            if (labels['__name__'] === 'kubelet_volume_stats_used_bytes') {
              const pvcName = labels['persistentvolumeclaim'];

              if (!pvcName.includes('zookeeper')) {

                item.values?.forEach((value, indexJ) => {
                  if (value.Timestamp == undefined) {
                    throw new Error('timestamp cannot be undefined');
                  }

                  if(index > 0) {
                    let newArray = avgBroker.data[indexJ].usedSpaceAvg.concat(value.Value);
                    avgBroker.data[indexJ].usedSpaceAvg = newArray;
                  }
                  else {
                    avgBroker.data.push({
                      timestamp: value.Timestamp,
                      usedSpaceAvg: [value.Value],
                    });
                  }
                })
              }
            }
            getChartData(avgBroker);
          })
        }
        else {
          setMetricsDataUnavailable(true);
          setChartDataLoading(false);
        }
      } catch (error) {
      let reason: string | undefined;
      if (isServiceApiError(error)) {
        reason = error.response?.data.reason;
      }
        addAlert(t('something_went_wrong'), AlertVariant.danger, reason);
      }
    }
  };

  useEffect(() => {
    fetchUsedDiskSpaceMetrics();
    handleResize();
  }, []);

  useTimeout(() => fetchUsedDiskSpaceMetrics(), 1000 * 60 * 5);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
  }, [width]);

  const getChartData = (avgBroker) => {

    let legendData: Array<LegendData> = [
      {name: 'Limit', symbol: { fill: chart_color_black_500.value, type: 'threshold'}},
      {name: avgBroker.name, symbol: { fill: chart_color_blue_300.value }}
    ];

    const areaColor = chart_color_blue_300.value;
    const softLimitColor = chart_color_black_500.value;
    let chartData: Array<ChartData> = [];
    let area: Array<BrokerChartData> = [];
    let softLimit: Array<BrokerChartData> = [];
    let largestByteSize = 'GB'; // Hard code GB as the largest byte size because there will always be a 20 GB limit.

    const getCurrentLengthOfData = () => {
      let timestampDiff = avgBroker.data[avgBroker.data.length - 1].timestamp - avgBroker.data[0].timestamp;
      const minutes = timestampDiff / 1000 / 60;
      return minutes;
    }

    let lengthOfData = (6 * 60) - getCurrentLengthOfData();
    let lengthOfDataPer5Mins = ((6 * 60) - getCurrentLengthOfData()) / 5;

    if (lengthOfData <= 360) {
      for (var i = 0; i < lengthOfDataPer5Mins; i = i+1) {
        const newTimestamp = (avgBroker.data[0].timestamp - ((lengthOfDataPer5Mins - i) * (5 * 60000)));
        const date = new Date(newTimestamp);
        const time = format(date, 'hh:mm');
        area.push({ name: avgBroker.name, x: time, y: 0})
        softLimit.push({ name: 'Limit', x: time, y: usageLimit });
      }
    }

    const average = (nums) => {
      return nums.reduce((a, b) => (a + b)) / nums.length;
    }

    avgBroker.data.map(value => {
      const date = new Date(value.timestamp);
      const time = format(date, 'hh:mm');
      const averageBytes = average(value.usedSpaceAvg);
      const bytes = convertToSpecifiedByte(averageBytes, largestByteSize);
      area.push({ name: avgBroker.name, x: time, y: bytes });
      softLimit.push({ name: 'Soft limit', x: time, y: usageLimit });
    });
    chartData.push({ areaColor, softLimitColor, area, softLimit });

    setLegend(legendData);
    setChartData(chartData);
    setLargestByteSize(largestByteSize);
    setChartDataLoading(false);
  }

    return (
      <Card>
        <CardTitle component="h2">
          {t('metrics.used_disk_space')}
        </CardTitle>
        <CardBody>
          <div ref={containerRef}>
            { !chartDataLoading ? (
              !metricsDataUnavailable ? (
                chartData && legend && largestByteSize &&
                <Chart
                  ariaDesc={t('metrics.used_disk_space')}
                  ariaTitle="Disk Space"
                  containerComponent={
                    <ChartVoronoiContainer
                      labels={({ datum }) => `${datum.name}: ${datum.y}`}
                      constrainToVisibleArea
                    />
                  }
                  legendPosition="bottom-left"
                  legendComponent={
                    <ChartLegend
                      orientation={'horizontal'}
                      data={legend}
                      itemsPerRow={itemsPerRow}
                    />
                  }
                  height={350}
                  padding={{
                    bottom: 110, // Adjusted to accomodate legend
                    left: 90,
                    right: 60,
                    top: 25
                  }}
                  themeColor={ChartThemeColor.multiUnordered}
                  width={width}
                  minDomain={{ y: 0 }}
                  legendAllowWrap={true}
                >
                  <ChartAxis label={'Time'} tickCount={6} />
                  <ChartAxis
                    dependentAxis
                    tickFormat={(t) => `${Math.round(t)} ${largestByteSize}`}
                    tickCount={4}
                  />
                    <ChartGroup>
                      {chartData.map((value, index) => (
                        <ChartArea
                          key={`chart-area-${index}`}
                          data={value.area}
                          interpolation="monotoneX"
                          style={{
                            data: {
                              stroke: value.color
                            }
                          }}
                        />
                      ))}
                    </ChartGroup>
                    <ChartThreshold
                      key={`chart-softlimit`}
                      data={chartData[0].softLimit}
                      style={{
                        data: {
                          stroke: chartData[0].softLimitColor
                        }
                      }}
                    />
                </Chart>
              ) : (
                <ChartEmptyState
                  title="No data"
                  body="We’re creating your Kafka instance, so some details aren’t yet available."
                  noData
                />
              )
            ) : (
              <Bullseye>
                <Spinner isSVG/>
              </Bullseye>
            )}
          </div>
        </CardBody>
      </Card>
  );
}