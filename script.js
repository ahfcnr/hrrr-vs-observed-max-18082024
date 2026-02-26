let forecastData = [];
let observedData = {};

const dateBase = "2024-08-18";
const regionImages = {
    "Dover": "images/Dover.png",
    "Englewood": "images/Englewood.png",
    "Irvington": "images/Irvington.png",
    "Leonia": "images/Leonia.png",
    "Paterson": "images/Paterson.png",
    "Plainfield": "images/Plainfield.png",
    "Rahway": "images/Rahway.png",
    "Scotch Plains": "images/Scotch Plains.png",
    "Totowa": "images/Totowa.png",
    "Woodland Park": "images/Woodland Park.png"
};

// ===============================
// LOAD DATA
// ===============================
Promise.all([
    fetch("hrrr_forecast_all_runs_app.csv").then(res => res.text()),
    fetch("observed_data.json").then(res => res.json())
]).then(([csvText, obsJson]) => {
    observedData = obsJson;
    const rows = csvText.split("\n").slice(1);

    rows.forEach(r => {
        const cols = r.split(",");
        if (cols.length < 8) return;

        let runTimeStr = cols[0].trim();
        let leadHours = parseInt(cols[1]);
        
        // Reconstruct Valid Time to ISO for alignment
        let runDate = new Date(runTimeStr);
        let validDate = new Date(runDate);
        validDate.setHours(validDate.getHours() + leadHours);
        let validTimeISO = formatLocalISO(validDate);

        forecastData.push({
            run_time: runTimeStr,
            lead: leadHours,
            valid_time: validTimeISO, 
            region: cols[3].trim(),
            cell_id: cols[4].trim(),
            rain: parseFloat(cols[7])
        });
    });

    initializeDropdowns();
}).catch(err => console.error("Error loading data:", err));

// ===============================
// INITIALIZE DROPDOWNS
// ===============================
function initializeDropdowns() {
    const targetSelect = document.getElementById("targetSelect");
    for (let h = 0; h < 24; h++) {
        const hour = String(h).padStart(2, "0");
        const option = document.createElement("option");
        option.value = `${dateBase}T${hour}:00:00`;   
        option.text = `${dateBase} ${hour}:00`;
        targetSelect.appendChild(option);
    }

    const leadSelect = document.getElementById("leadSelect");
    for (let l = 1; l <= 18; l++) {
        const option = document.createElement("option");
        option.value = l;
        option.text = l;
        leadSelect.appendChild(option);
    }

    const regions = [...new Set(forecastData.map(d => d.region))];
    const regionSelect = document.getElementById("regionSelect");
    regions.forEach(r => {
        const opt = document.createElement("option");
        opt.value = r;
        opt.text = r;
        regionSelect.appendChild(opt);
    });

    document.getElementById("targetSelect").addEventListener("change", computeDataGenerationTime);
    document.getElementById("leadSelect").addEventListener("change", computeDataGenerationTime);
}

function formatLocalISO(date) {
    const pad = n => String(n).padStart(2, "0");
    return date.getFullYear() + "-" +
        pad(date.getMonth() + 1) + "-" +
        pad(date.getDate()) + "T" +
        pad(date.getHours()) + ":00:00";
}

function computeDataGenerationTime() {
    const targetVal = document.getElementById("targetSelect").value;
    const leadVal = document.getElementById("leadSelect").value;
    if (!targetVal || !leadVal) return;

    const target = new Date(targetVal);
    const lead = parseInt(leadVal);
    const run = new Date(target);
    run.setHours(run.getHours() - lead);

    document.getElementById("runTimeBox").value = formatLocalISO(run);
}

// ===============================
// UPDATE PLOTS
// ===============================
function updatePlot() {
    const targetStr = document.getElementById("targetSelect").value;
    const lead = parseInt(document.getElementById("leadSelect").value);
    const region = document.getElementById("regionSelect").value;

    if (!targetStr || !lead || !region) {
        alert("Select all inputs.");
        return;
    }

    const target = new Date(targetStr);
    const run = new Date(target);
    run.setHours(run.getHours() - lead);
    const runStr = formatLocalISO(run);

    const filtered = forecastData.filter(d => d.region === region && d.run_time === runStr);

    if (filtered.length === 0) {
        alert("No data found for this selection.");
        return;
    }

    // 1. Prepare Observed Data (Used in both plots)
    let obsTimes = [];
    let obsValues = [];
    if (observedData[region]) {
        Object.keys(observedData[region]).forEach(t => {
            obsTimes.push(t.replace(" ", "T"));
            obsValues.push(observedData[region][t]);
        });
    }

    // 2. NEW LOGIC: Calculate Max Forecast Rain per Time Step
    const validTimes = [...new Set(filtered.map(d => d.valid_time))].sort();
    
    let maxForecastY = [];
    validTimes.forEach(time => {
        const valuesAtTime = filtered
            .filter(d => d.valid_time === time)
            .map(d => d.rain);
        maxForecastY.push(Math.max(...valuesAtTime));
    });

    let forecastTraces = [];
    forecastTraces.push({
        x: validTimes,
        y: maxForecastY,
        mode: "lines",
        name: "Max Forecast (All Cells)",
        line: { color: "blue", width: 3 }
    });

    // 3. Add Observed Reference Line to Forecast Plot (Dotted)
    forecastTraces.push({
        x: obsTimes,
        y: obsValues,
        mode: "lines",
        name: "Observed (Ref)",
        line: { color: "black", width: 2, dash: "dot" }
    });

    // 4. Shared Axis Configuration
    const xMin = runStr; 
    const xMaxDate = new Date(run);
    xMaxDate.setHours(xMaxDate.getHours() + 19);
    const xMax = formatLocalISO(xMaxDate);

    const maxObs = obsValues.length > 0 ? Math.max(...obsValues) : 0;
    let forecastMax = 0;
    forecastTraces.forEach(trace => {
        const maxTrace = Math.max(...trace.y);
        if (maxTrace > forecastMax) {
              forecastMax = maxTrace;
    }
});

// Final Y max = ceil(max of both)
    const yMax = Math.ceil(Math.max(maxObs, forecastMax)) || 1;

    const sharedLayout = {
        xaxis: {
            title: "Valid Time (EDT)",
            range: [xMin, xMax],            // Fixed 19hr window starting at Data Gen Time
            rangeslider: { visible: false }, // Removed sliding axis
            dtick: 2 * 60 * 60 * 1000,      // 3 hr labels
            type: 'date',
            tickformat: "%H:%M\n%b %d"
        },
        yaxis: {
            title: "Rainfall (inches)",
            range: [0, yMax]                // Synced scale based on observed ceiling
        },
        margin: { t: 50, b: 80 }
    };

    // 5. Render Forecast Plot (Max Line + Dotted Observed)
    Plotly.newPlot("forecastPlot", forecastTraces, {
        ...sharedLayout,
        title: `HRRR Max Forecast – ${region}`
    });

    // 6. Render Separate Observed Plot (Solid Line)
    const observedTrace = {
        x: obsTimes,
        y: obsValues,
        mode: "lines",
        name: "Observed",
        line: { color: "black", width: 3 }
    };

    Plotly.newPlot("observedPlot", [observedTrace], {
        ...sharedLayout,
        title: `Observed Rainfall – ${region}`
    });
    const imgElement = document.getElementById("regionPhoto");
    const titleElement = document.getElementById("imageTitle");
    
    if (regionImages[region]) {
        imgElement.src = regionImages[region];
        imgElement.style.display = "block";
        titleElement.innerText = `Site Map: ${region}`;
    } else {
        imgElement.style.display = "none";
        titleElement.innerText = "";
    }


}
