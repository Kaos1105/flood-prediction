// 1. Load Quảng Ngãi province boundary
var quangNgai = ee.FeatureCollection("FAO/GAUL/2015/level1")
  .filter(ee.Filter.eq('ADM1_NAME', 'Quang Ngai'));

// 2. Load CHIRPS Daily Precipitation Data
var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterDate('2000-01-01', '2025-01-01')
  .filterBounds(quangNgai);

// 3. Load GLDAS 3-hourly Data
var gldas = ee.ImageCollection("NASA/GLDAS/V021/NOAH/G025/T3H")
  .filterDate('2000-01-01', '2025-01-01')
  .filterBounds(quangNgai);

// 4. Generate daily features by looping through CHIRPS dates
var dailyRain = chirps.map(function(img) {
  var date = img.date();

  // ----- CHIRPS: Current day stats -----
  var stats = img.reduceRegion({
    reducer: ee.Reducer.mean()
              .combine(ee.Reducer.max(), '', true)
              .combine(ee.Reducer.stdDev(), '', true),
    geometry: quangNgai.geometry(),
    scale: 5000,
    maxPixels: 1e13
  });

  // ----- CHIRPS: 3-day cumulative rain -----
  var cumRain = chirps
    .filterDate(date.advance(-2, 'day'), date.advance(1, 'day')) // t-2 to t
    .sum()
    .reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: quangNgai.geometry(),
      scale: 5000,
      maxPixels: 1e13
    });

  // ----- GLDAS: Daily window -----
  var gldasDay = gldas.filterDate(date, date.advance(1, 'day'));
  var gldasSize = gldasDay.size();

  // Safely reduce GLDAS bands with fallback for missing days
  var qsDaily = ee.Image(
    ee.Algorithms.If(
      gldasSize.gt(0),
      gldasDay.select('Qs_acc').reduce(ee.Reducer.sum()).rename('Qs_acc'),
      ee.Image.constant(-9999).rename('Qs_acc')
    )
  );

  var qsbDaily = ee.Image(
    ee.Algorithms.If(
      gldasSize.gt(0),
      gldasDay.select('Qsb_acc').reduce(ee.Reducer.sum()).rename('Qsb_acc'),
      ee.Image.constant(-9999).rename('Qsb_acc')
    )
  );

  var soilDaily = ee.Image(
    ee.Algorithms.If(
      gldasSize.gt(0),
      gldasDay.select('SoilMoi0_10cm_inst').reduce(ee.Reducer.mean()).rename('SoilMoi0_10cm_inst'),
      ee.Image.constant(-9999).rename('SoilMoi0_10cm_inst')
    )
  );

  var gldasStats = qsDaily
    .addBands([qsbDaily, soilDaily])
    .reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: quangNgai.geometry(),
      scale: 25000,
      maxPixels: 1e13
    });

  // Combine all features into one Feature object
  return ee.Feature(null, {
    'date': date.format('YYYY-MM-dd'),

    // CHIRPS
    'rainfall_mean_mm': stats.get('precipitation_mean'),
    'rainfall_max_mm': stats.get('precipitation_max'),
    'rainfall_std_mm': stats.get('precipitation_stdDev'),
    'rainfall_3day_cumulative_mm': cumRain.get('precipitation'),

    // GLDAS
    'surface_runoff_mm': gldasStats.get('Qs_acc'),
    'subsurface_runoff_mm': gldasStats.get('Qsb_acc'),
    'soil_moisture_top10cm_mm': gldasStats.get('SoilMoi0_10cm_inst')
  });
});

// 5. Export to CSV
Export.table.toDrive({
  collection: dailyRain,
  description: 'QuangNgai_Daily_Flood_Features',
  fileFormat: 'CSV'
});
